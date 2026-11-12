import {
  CommandId,
  type ModelSelection,
  OPERATOR_TASK_OPEN_LIMIT,
  OPERATOR_TASK_RETENTION_MS,
  OperatorTaskId,
  type OperatorTask,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import { decideOperatorTaskCommand } from "./OperatorTaskDecider.ts";

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} satisfies ModelSelection;
const now = DateTime.makeUnsafe("2026-11-12T12:00:00.000Z");
const threadId = ThreadId.make("thread:owner");
const otherThreadId = ThreadId.make("thread:other");

const makeThread = (
  overrides: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread => ({
  createdBy: "user",
  creationSource: "web",
  id: threadId,
  projectId: ProjectId.make("project:tasks"),
  title: "Waiting thread",
  providerInstanceId: modelSelection.instanceId,
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
  ...overrides,
});

type Command<T extends OrchestrationV2ServerCommand["type"]> = Extract<
  OrchestrationV2ServerCommand,
  { readonly type: T }
>;

const add = (
  id: string,
  taskId: string,
  extra: Partial<Command<"thread.operator-task.add">> = {},
) =>
  ({
    type: "thread.operator-task.add",
    commandId: CommandId.make(id),
    threadId,
    taskId: OperatorTaskId.make(taskId),
    action: "Run the migration",
    createdByThreadId: threadId,
    ...extra,
  }) satisfies Command<"thread.operator-task.add">;
const done = (id: string, taskId: string) =>
  ({
    type: "thread.operator-task.done",
    commandId: CommandId.make(id),
    threadId,
    taskId: OperatorTaskId.make(taskId),
  }) satisfies Command<"thread.operator-task.done">;
const reopen = (id: string, taskId: string) =>
  ({
    type: "thread.operator-task.reopen",
    commandId: CommandId.make(id),
    threadId,
    taskId: OperatorTaskId.make(taskId),
  }) satisfies Command<"thread.operator-task.reopen">;
const update = (
  id: string,
  taskId: string,
  actorThreadId: ThreadId,
  extra: Partial<Command<"thread.operator-task.update">> = {},
) =>
  ({
    type: "thread.operator-task.update",
    commandId: CommandId.make(id),
    threadId,
    taskId: OperatorTaskId.make(taskId),
    actorThreadId,
    ...extra,
  }) satisfies Command<"thread.operator-task.update">;

const decide = (
  thread: OrchestrationV2AppThread,
  command: OrchestrationV2ServerCommand & { readonly type: `thread.operator-task.${string}` },
  options: { readonly canReceiveMessage?: boolean; readonly at?: DateTime.Utc } = {},
) =>
  decideOperatorTaskCommand({
    thread,
    command: command as never,
    now: options.at ?? now,
    canReceiveMessage: options.canReceiveMessage ?? true,
  });
const ok = <A>(result: Result.Result<A, string>): A => {
  if (Result.isFailure(result)) assert.fail(`expected success, got: ${result.failure}`);
  return result.success;
};
const fail = <A>(result: Result.Result<A, string>): string => {
  if (Result.isSuccess(result)) assert.fail("expected failure");
  return result.failure;
};
const taskOf = (thread: OrchestrationV2AppThread, taskId: string): OperatorTask => {
  const task = thread.operatorTasks?.find((candidate) => candidate.id === taskId);
  if (task === undefined) assert.fail(`task ${taskId} missing`);
  return task;
};

describe("decideOperatorTaskCommand add", () => {
  it("records an open item that takes its project from the thread", () => {
    const { thread } = ok(
      decide(makeThread(), add("c1", "task:1", { instructions: "```sh\nnpm run db\n```" })),
    );
    assert.deepEqual(taskOf(thread, "task:1"), {
      id: OperatorTaskId.make("task:1"),
      threadId,
      projectId: ProjectId.make("project:tasks"),
      createdByThreadId: threadId,
      action: "Run the migration",
      instructions: "```sh\nnpm run db\n```",
      dueAt: null,
      state: "open",
      closeReason: null,
      doneAt: null,
      doneDelivery: null,
      createdAt: "2026-11-12T12:00:00.000Z",
      updatedAt: "2026-11-12T12:00:00.000Z",
    });
  });

  it("does not move the thread in the sidebar", () => {
    const before = makeThread();
    const { thread } = ok(decide(before, add("c1", "task:1")));
    assert.equal(thread.updatedAt, before.updatedAt);
  });

  it("rejects a second item with the same id instead of duplicating it", () => {
    const first = ok(decide(makeThread(), add("c1", "task:1"))).thread;
    fail(decide(first, add("c2", "task:1")));
    assert.lengthOf(first.operatorTasks ?? [], 1);
  });

  it("refuses an open item past the per-thread limit", () => {
    let thread = makeThread();
    for (let index = 0; index < OPERATOR_TASK_OPEN_LIMIT; index += 1) {
      thread = ok(decide(thread, add(`c${index}`, `task:${index}`))).thread;
    }
    fail(decide(thread, add("c-over", "task:over")));
  });

  it("drops done and closed items older than the retention window on the next write", () => {
    const old = DateTime.formatIso(
      DateTime.makeUnsafe(DateTime.toEpochMillis(now) - OPERATOR_TASK_RETENTION_MS - 1),
    );
    const stale = (id: string, state: "done" | "closed"): OperatorTask => ({
      ...taskOf(ok(decide(makeThread(), add("seed", id))).thread, id),
      state,
      doneAt: state === "done" ? old : null,
      closeReason: state === "closed" ? "seen" : null,
      updatedAt: old,
    });
    const thread = makeThread({
      operatorTasks: [stale("task:old-done", "done"), stale("task:old-closed", "closed")],
    });
    const next = ok(decide(thread, add("c1", "task:new"))).thread;
    assert.deepEqual(
      next.operatorTasks?.map((task) => task.id),
      ["task:new"],
    );
  });
});

describe("decideOperatorTaskCommand update", () => {
  const withTask = () => ok(decide(makeThread(), add("c1", "task:1"))).thread;

  it("lets the owning thread edit and close its item", () => {
    const edited = ok(
      decide(
        withTask(),
        update("c2", "task:1", threadId, {
          action: "Run the migration on staging",
          dueAt: "2026-11-13T09:00:00.000Z",
        }),
      ),
    ).thread;
    assert.equal(taskOf(edited, "task:1").action, "Run the migration on staging");
    assert.equal(taskOf(edited, "task:1").dueAt, "2026-11-13T09:00:00.000Z");
    const closed = ok(
      decide(edited, update("c3", "task:1", threadId, { close: { reason: "Saw the result" } })),
    ).thread;
    assert.equal(taskOf(closed, "task:1").state, "closed");
    assert.equal(taskOf(closed, "task:1").closeReason, "Saw the result");
  });

  it("rejects a foreign thread, and an unknown item", () => {
    fail(decide(withTask(), update("c2", "task:1", otherThreadId, { close: { reason: "mine" } })));
    fail(decide(withTask(), update("c2", "task:missing", threadId, { close: { reason: "x" } })));
  });

  it("keeps a done item done when its thread closes it afterwards", () => {
    const finished = ok(decide(withTask(), done("c2", "task:1"))).thread;
    const result = ok(
      decide(finished, update("c3", "task:1", threadId, { close: { reason: "late" } })),
    );
    assert.strictEqual(result.thread, finished);
    assert.equal(taskOf(result.thread, "task:1").state, "done");
  });

  it("rejects editing an item that is no longer open", () => {
    const finished = ok(decide(withTask(), done("c2", "task:1"))).thread;
    fail(decide(finished, update("c3", "task:1", threadId, { action: "Too late" })));
  });
});

describe("decideOperatorTaskCommand done", () => {
  const withTask = () => ok(decide(makeThread(), add("c1", "task:1"))).thread;

  it("marks the item done and returns one message for the thread", () => {
    const result = ok(decide(withTask(), done("click-1", "task:1")));
    const task = taskOf(result.thread, "task:1");
    assert.equal(task.state, "done");
    assert.equal(task.doneAt, "2026-11-12T12:00:00.000Z");
    assert.equal(task.doneDelivery, "queued");
    assert.deepEqual(result.wake, {
      messageId: "message:operator-task-done:click-1",
      text: "The operator marked this task done: Run the migration",
    });
  });

  it("does nothing the second time, whatever the command id", () => {
    const first = ok(decide(withTask(), done("click-1", "task:1"))).thread;
    const second = ok(decide(first, done("click-2", "task:1")));
    assert.strictEqual(second.thread, first);
    assert.isNull(second.wake);
  });

  it("does not send Done for an item its thread already closed", () => {
    const closed = ok(
      decide(withTask(), update("c2", "task:1", threadId, { close: { reason: "Saw it" } })),
    ).thread;
    const result = ok(decide(closed, done("click-1", "task:1")));
    assert.strictEqual(result.thread, closed);
    assert.isNull(result.wake);
  });

  it("marks done without a message when the thread is archived", () => {
    const archived = makeThread({ ...withTask(), archivedAt: now });
    const result = ok(decide(archived, done("click-1", "task:1")));
    assert.equal(taskOf(result.thread, "task:1").state, "done");
    assert.equal(taskOf(result.thread, "task:1").doneDelivery, "thread_archived");
    assert.isNull(result.wake);
  });

  it("marks done without a message when the thread cannot receive one", () => {
    const result = ok(decide(withTask(), done("click-1", "task:1"), { canReceiveMessage: false }));
    assert.equal(taskOf(result.thread, "task:1").doneDelivery, "thread_cannot_receive");
    assert.isNull(result.wake);
  });

  it("rejects an unknown item", () => {
    fail(decide(withTask(), done("click-1", "task:missing")));
  });
});

describe("decideOperatorTaskCommand reopen", () => {
  const withDone = () =>
    ok(decide(ok(decide(makeThread(), add("c1", "task:1"))).thread, done("c2", "task:1"))).thread;

  it("returns a done item to open and clears what Done recorded", () => {
    const reopened = ok(decide(withDone(), reopen("c3", "task:1"))).thread;
    const task = taskOf(reopened, "task:1");
    assert.equal(task.state, "open");
    assert.isNull(task.doneAt);
    assert.isNull(task.doneDelivery);
  });

  it("sends a new message when an item is done again, with a new message id", () => {
    const again = ok(
      decide(ok(decide(withDone(), reopen("c3", "task:1"))).thread, done("c4", "task:1")),
    );
    assert.equal(again.wake?.messageId, "message:operator-task-done:c4");
  });

  it("does nothing for an item that is already open", () => {
    const open = ok(decide(makeThread(), add("c1", "task:1"))).thread;
    const result = ok(decide(open, reopen("c2", "task:1")));
    assert.strictEqual(result.thread, open);
  });
});
