import { assert, it } from "@effect/vitest";
import {
  CommandId,
  OperatorTaskId,
  OrchestrationV2Command,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for operator tasks"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "operator-tasks" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const owner = ThreadId.make("thread:task-owner");
const other = ThreadId.make("thread:task-other");
const taskId = OperatorTaskId.make("task:one");
const DONE_PREFIX = "The operator marked this task done:";

const createThread = (orchestrator: Orchestrator.OrchestratorV2["Service"], threadId: ThreadId) =>
  orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId: ProjectId.make("project:tasks"),
    title: `Thread ${threadId}`,
    modelSelection: { instanceId, model: "gpt-5.1-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });

const addTask = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  input: {
    readonly commandId?: string;
    readonly threadId?: ThreadId;
    readonly taskId?: OperatorTaskId;
  } = {},
) =>
  orchestrator.dispatch({
    type: "thread.operator-task.add",
    commandId: CommandId.make(input.commandId ?? "add-1"),
    threadId: input.threadId ?? owner,
    taskId: input.taskId ?? taskId,
    action: "Run the migration",
    instructions: "```sh\nnpm run db\n```",
    createdByThreadId: owner,
  });
const doneTask = (orchestrator: Orchestrator.OrchestratorV2["Service"], commandId: string) =>
  orchestrator.dispatch({
    type: "thread.operator-task.done",
    commandId: CommandId.make(commandId),
    threadId: owner,
    taskId,
  });
const reopenTask = (orchestrator: Orchestrator.OrchestratorV2["Service"], commandId: string) =>
  orchestrator.dispatch({
    type: "thread.operator-task.reopen",
    commandId: CommandId.make(commandId),
    threadId: owner,
    taskId,
  });
const closeTask = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  commandId: string,
  actorThreadId: ThreadId,
) =>
  orchestrator.dispatch({
    type: "thread.operator-task.update",
    commandId: CommandId.make(commandId),
    threadId: owner,
    taskId,
    actorThreadId,
    close: { reason: "Saw the result" },
  });

const setup = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* createThread(orchestrator, owner);
  yield* createThread(orchestrator, other);
  return orchestrator;
});
const doneMessages = (projection: {
  readonly messages: ReadonlyArray<{ readonly id: string; readonly text: string }>;
}) => projection.messages.filter((message) => message.text.startsWith(DONE_PREFIX));

it.effect("adds an item once, however many times the same command or id is replayed", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const before = yield* projections.getThreadProjection(owner);
    // The test clock stands still, so move it: a bump to updatedAt must show.
    yield* TestClock.adjust("1 minute");
    yield* addTask(orchestrator);
    yield* addTask(orchestrator);
    assert.isTrue(
      Exit.isFailure(yield* Effect.exit(addTask(orchestrator, { commandId: "add-2" }))),
    );
    const after = yield* projections.getThreadProjection(owner);
    assert.lengthOf(after.thread.operatorTasks ?? [], 1);
    assert.equal(after.thread.operatorTasks?.[0]?.state, "open");
    assert.equal(after.thread.updatedAt.toString(), before.thread.updatedAt.toString());
    assert.isAbove(
      Date.parse(after.thread.operatorTasks![0]!.createdAt),
      DateTime.toEpochMillis(before.thread.updatedAt),
    );
    assert.equal(
      (yield* projections.getThreadShell(owner))?.updatedAt.toString(),
      (yield* projections.getThreadShell(owner))?.createdAt.toString(),
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects an item for a thread that does not exist or is deleted", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    assert.isTrue(
      Exit.isFailure(
        yield* Effect.exit(
          addTask(orchestrator, { threadId: ThreadId.make("thread:unknown"), commandId: "add-x" }),
        ),
      ),
    );
    yield* orchestrator.dispatch({
      type: "thread.delete",
      commandId: CommandId.make("delete-other"),
      threadId: other,
    });
    assert.isTrue(
      Exit.isFailure(
        yield* Effect.exit(addTask(orchestrator, { threadId: other, commandId: "add-y" })),
      ),
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("queues exactly one message per Done, however many clicks and retries", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    yield* doneTask(orchestrator, "click-1");
    // Same click retried, then a second click from another device.
    yield* doneTask(orchestrator, "click-1");
    yield* doneTask(orchestrator, "click-2");
    const projection = yield* projections.getThreadProjection(owner);
    assert.equal(projection.thread.operatorTasks?.[0]?.state, "done");
    assert.equal(projection.thread.operatorTasks?.[0]?.doneDelivery, "queued");
    const messages = doneMessages(projection);
    assert.lengthOf(messages, 1);
    assert.equal(messages[0]?.text, `${DONE_PREFIX} Run the migration`);
    assert.equal(messages[0]?.id, "message:operator-task-done:click-1");
    assert.lengthOf(projection.runs, 1);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("sends a second message when an item is reopened and done again", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    yield* doneTask(orchestrator, "click-1");
    yield* reopenTask(orchestrator, "reopen-1");
    assert.equal(
      (yield* projections.getThreadProjection(owner)).thread.operatorTasks?.[0]?.state,
      "open",
    );
    yield* doneTask(orchestrator, "click-2");
    const messages = doneMessages(yield* projections.getThreadProjection(owner));
    assert.deepEqual(messages.map((message) => message.id).toSorted(), [
      "message:operator-task-done:click-1",
      "message:operator-task-done:click-2",
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("settles a race between the thread closing an item and the operator's Done", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    yield* Effect.all(
      [closeTask(orchestrator, "close-1", owner), doneTask(orchestrator, "click-1")],
      { concurrency: "unbounded" },
    );
    const projection = yield* projections.getThreadProjection(owner);
    const task = projection.thread.operatorTasks?.[0];
    assert.lengthOf(projection.thread.operatorTasks ?? [], 1);
    assert.include(["done", "closed"], task?.state);
    // A message goes out if and only if the final state is done.
    assert.lengthOf(doneMessages(projection), task?.state === "done" ? 1 : 0);
    assert.equal(
      task?.state === "closed" ? task.closeReason : null,
      task?.state === "closed" ? "Saw the result" : null,
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps a close that was recorded when Done comes after it", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    yield* closeTask(orchestrator, "close-1", owner);
    yield* doneTask(orchestrator, "click-1");
    const projection = yield* projections.getThreadProjection(owner);
    assert.equal(projection.thread.operatorTasks?.[0]?.state, "closed");
    assert.lengthOf(doneMessages(projection), 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("accepts a close on a done item and a reopen on an open item, and changes nothing", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    yield* reopenTask(orchestrator, "reopen-open");
    assert.equal(
      (yield* projections.getThreadProjection(owner)).thread.operatorTasks?.[0]?.state,
      "open",
    );
    yield* doneTask(orchestrator, "click-1");
    yield* closeTask(orchestrator, "close-late", owner);
    const projection = yield* projections.getThreadProjection(owner);
    assert.equal(projection.thread.operatorTasks?.[0]?.state, "done");
    assert.lengthOf(doneMessages(projection), 1);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("does not let another thread close an item", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    assert.isTrue(
      Exit.isFailure(yield* Effect.exit(closeTask(orchestrator, "close-foreign", other))),
    );
    assert.equal(
      (yield* projections.getThreadProjection(owner)).thread.operatorTasks?.[0]?.state,
      "open",
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("marks Done on an archived thread without sending a message", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    yield* orchestrator.dispatch({
      type: "thread.archive",
      commandId: CommandId.make("archive-owner"),
      threadId: owner,
    });
    yield* doneTask(orchestrator, "click-1");
    const projection = yield* projections.getThreadProjection(owner);
    assert.equal(projection.thread.operatorTasks?.[0]?.state, "done");
    assert.equal(projection.thread.operatorTasks?.[0]?.doneDelivery, "thread_archived");
    assert.lengthOf(doneMessages(projection), 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("wakes a settled thread when Done queues its message", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    yield* orchestrator.dispatch({
      type: "thread.settle",
      commandId: CommandId.make("settle-owner"),
      threadId: owner,
    });
    assert.equal((yield* projections.getThreadProjection(owner)).thread.settledOverride, "settled");
    yield* doneTask(orchestrator, "click-1");
    const projection = yield* projections.getThreadProjection(owner);
    assert.lengthOf(doneMessages(projection), 1);
    assert.notEqual(projection.thread.settledOverride, "settled");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps the same items when the thread's stored events are applied again", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const eventSink = yield* EventSink.EventSinkV2;
    yield* addTask(orchestrator);
    yield* addTask(orchestrator, {
      commandId: "add-second",
      taskId: OperatorTaskId.make("task:two"),
    });
    yield* doneTask(orchestrator, "click-1");
    yield* orchestrator.dispatch({
      type: "thread.operator-task.update",
      commandId: CommandId.make("close-1"),
      threadId: owner,
      taskId: OperatorTaskId.make("task:two"),
      actorThreadId: owner,
      close: { reason: "Saw the result" },
    });
    const live = (yield* projections.getThreadProjection(owner)).thread.operatorTasks;
    const stored = yield* Effect.forEach(
      [`create:${owner}`, "add-1", "add-second", "click-1", "close-1"],
      (id) =>
        eventSink.readByCommandId({ commandId: CommandId.make(id) }).pipe(
          Stream.runCollect,
          Effect.map((events) => Array.from(events)),
        ),
    ).pipe(Effect.map((groups) => groups.flat().toSorted((a, b) => a.sequence - b.sequence)));
    assert.isAbove(stored.length, 0);
    for (const event of stored) yield* projections.apply(event.event);
    const replayed = (yield* projections.getThreadProjection(owner)).thread.operatorTasks;
    assert.deepEqual(replayed, live);
    assert.deepEqual(
      replayed?.map((task) => `${task.id}:${task.state}`),
      ["task:one:done", "task:two:closed"],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("wakes a snoozed thread when Done queues its message", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* addTask(orchestrator);
    yield* orchestrator.dispatch({
      type: "thread.snooze",
      commandId: CommandId.make("snooze-owner"),
      threadId: owner,
      snoozedUntil: "2099-01-01T00:00:00.000Z",
    });
    assert.isNotNull((yield* projections.getThreadProjection(owner)).thread.snoozedUntil ?? null);
    yield* doneTask(orchestrator, "click-1");
    const projection = yield* projections.getThreadProjection(owner);
    assert.lengthOf(doneMessages(projection), 1);
    assert.isNull(projection.thread.snoozedUntil ?? null);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps every operator task command off the public command channel", () =>
  Effect.sync(() => {
    const isPublic = Schema.is(OrchestrationV2Command);
    const base = {
      commandId: "forged",
      threadId: owner,
      taskId: "task:one",
    };
    for (const forged of [
      { type: "thread.operator-task.done", ...base },
      { type: "thread.operator-task.reopen", ...base },
      { type: "thread.operator-task.add", ...base, action: "Do it", createdByThreadId: owner },
      // A forged actor field must not turn an update into one a client can send.
      {
        type: "thread.operator-task.update",
        ...base,
        actorThreadId: owner,
        actor: { kind: "operator" },
        close: { reason: "x" },
      },
    ]) {
      assert.isFalse(isPublic(forged), forged.type);
    }
  }),
);
