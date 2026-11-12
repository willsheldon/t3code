import {
  CommandId,
  type ModelSelection,
  OPERATOR_TASK_OPEN_LIMIT,
  OPERATOR_TASK_RETENTION_MS,
  OPERATOR_TASK_TEXT_LIMIT,
  OPERATOR_TASK_TOTAL_LIMIT,
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
  it("records an open item for the thread", () => {
    const { thread } = ok(
      decide(makeThread(), add("c1", "task:1", { instructions: "```sh\nnpm run db\n```" })),
    );
    assert.deepEqual(taskOf(thread, "task:1"), {
      id: OperatorTaskId.make("task:1"),
      threadId,
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
    const later = DateTime.makeUnsafe("2026-11-12T12:05:00.000Z");
    const { thread } = ok(decide(before, add("c1", "task:1"), { at: later }));
    assert.equal(taskOf(thread, "task:1").createdAt, "2026-11-12T12:05:00.000Z");
    assert.equal(thread.updatedAt, before.updatedAt);
  });

  it("rejects a second item with the same id instead of duplicating it", () => {
    const first = ok(decide(makeThread(), add("c1", "task:1"))).thread;
    assert.include(fail(decide(first, add("c2", "task:1"))), "already exists");
  });

  it("refuses an open item past the per-thread limit", () => {
    let thread = makeThread();
    for (let index = 0; index < OPERATOR_TASK_OPEN_LIMIT; index += 1) {
      thread = ok(decide(thread, add(`c${index}`, `task:${index}`))).thread;
    }
    fail(decide(thread, add("c-over", "task:over")));
  });

  it("keeps a thread's items under the total limit by dropping its oldest finished ones", () => {
    const finished = (index: number): OperatorTask => ({
      ...taskOf(ok(decide(makeThread(), add("seed", `task:${index}`))).thread, `task:${index}`),
      state: "done",
      doneAt: "2026-11-12T11:00:00.000Z",
      doneDelivery: "queued",
      // Newer than the retention cutoff, and in age order: task:0 is the oldest.
      updatedAt: DateTime.formatIso(
        DateTime.makeUnsafe(Date.parse("2026-11-12T10:00:00.000Z") + index * 1000),
      ),
    });
    const full = makeThread({
      operatorTasks: Array.from({ length: OPERATOR_TASK_TOTAL_LIMIT }, (_, index) =>
        finished(index),
      ),
    });
    const next = ok(decide(full, add("c1", "task:new"))).thread;
    assert.lengthOf(next.operatorTasks ?? [], OPERATOR_TASK_TOTAL_LIMIT);
    assert.isUndefined(next.operatorTasks?.find((task) => task.id === "task:0"));
    assert.equal(taskOf(next, "task:1").state, "done");
    assert.equal(taskOf(next, "task:new").state, "open");
  });

  it("bounds the instruction text a thread holds, so its payload stays small", () => {
    const withText = (thread: OrchestrationV2AppThread, id: string, length: number) =>
      decide(thread, add(`c-${id}`, `task:${id}`, { instructions: "x".repeat(length) }));
    // Nine open items just under the cap; one edit within the schema's per-item limit passes it.
    let thread = makeThread();
    for (let index = 0; index < 9; index += 1) {
      thread = ok(withText(thread, `open-${index}`, 7_100)).thread;
    }
    // Open items are never dropped to make room.
    assert.include(fail(withText(thread, "over", 1_000)), "too much text");
    const edit = update("c-edit", "task:open-0", threadId, { instructions: "x".repeat(8_000) });
    assert.include(fail(decide(thread, edit)), "too much text");
    // Shrinking and Done never fail for text.
    ok(decide(thread, update("c-shrink", "task:open-0", threadId, { instructions: "x" })));
    ok(decide(thread, done("c-done", "task:open-0")));
  });

  it("drops the oldest finished items to make room for new text", () => {
    const chunk = OPERATOR_TASK_TEXT_LIMIT / 8;
    const finished = (index: number): OperatorTask => ({
      ...taskOf(
        ok(decide(makeThread(), add("seed", `task:${index}`, { instructions: "x".repeat(chunk) })))
          .thread,
        `task:${index}`,
      ),
      state: "done",
      doneAt: "2026-11-12T11:00:00.000Z",
      doneDelivery: "queued",
      updatedAt: DateTime.formatIso(
        DateTime.makeUnsafe(Date.parse("2026-11-12T10:00:00.000Z") + index * 1000),
      ),
    });
    const full = makeThread({
      operatorTasks: Array.from({ length: 8 }, (_, index) => finished(index)),
    });
    const next = ok(
      decide(full, add("c1", "task:new", { instructions: "x".repeat(chunk) })),
    ).thread;
    assert.isUndefined(next.operatorTasks?.find((task) => task.id === "task:0"));
    assert.equal(taskOf(next, "task:7").state, "done");
    assert.equal(taskOf(next, "task:new").state, "open");
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

describe("decideOperatorTaskCommand foreign items", () => {
  // A thread payload copied from another thread brings that thread's items with it.
  const copied = (): OrchestrationV2AppThread => {
    const task = taskOf(
      ok(decide(makeThread(), add("seed", "task:foreign"))).thread,
      "task:foreign",
    );
    return makeThread({
      id: otherThreadId,
      operatorTasks: [{ ...task, threadId: threadId }],
    });
  };

  it("does not act on an item that belongs to another thread", () => {
    fail(decide(copied(), { ...done("c1", "task:foreign"), threadId: otherThreadId }));
    fail(
      decide(copied(), {
        ...update("c2", "task:foreign", threadId, { close: { reason: "x" } }),
        threadId: otherThreadId,
      }),
    );
  });

  it("drops such an item on the thread's next task write", () => {
    const next = ok(decide(copied(), { ...add("c1", "task:own"), threadId: otherThreadId })).thread;
    assert.deepEqual(
      next.operatorTasks?.map((task) => task.id),
      ["task:own"],
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
