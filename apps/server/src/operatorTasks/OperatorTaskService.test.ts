import { assert, it } from "@effect/vitest";
import {
  CommandId,
  type OperatorTaskId,
  type OperatorTaskListResult,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as OperatorTaskService from "./OperatorTaskService.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for operator tasks"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerBase = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "operator-task-service" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);
let randomCalls = 0;
// Distinct ids per call, so repeated adds do not collide.
const testCrypto = SecureRandom.make((size) => new Uint8Array(size).fill(++randomCalls % 256));
const layerTest = OperatorTaskService.layer.pipe(
  Layer.provide(Layer.succeed(SecureRandom.SecureRandom, testCrypto)),
  Layer.provideMerge(layerBase),
);

const owner = ThreadId.make("thread:svc-owner");
const other = ThreadId.make("thread:svc-other");
const projectA = ProjectId.make("project:svc-a");
const projectB = ProjectId.make("project:svc-b");

const createThread = (threadId: ThreadId, projectId: ProjectId, title = `Title ${threadId}`) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId,
      projectId,
      title,
      modelSelection: { instanceId, model: "gpt-5.1-codex" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
  });

const setup = Effect.gen(function* () {
  yield* createThread(owner, projectA, "Waiting thread");
  yield* createThread(other, projectB);
  return yield* OperatorTaskService.OperatorTaskService;
});
const doneCount = (messages: ReadonlyArray<{ readonly text: string }>) =>
  messages.filter((message) => message.text.startsWith("The operator marked this task done:"))
    .length;

it.effect(
  "adds an item for the calling thread and lists it with its thread's title and project",
  () =>
    Effect.gen(function* () {
      const service = yield* setup;
      const added = yield* service.add({ actorThreadId: owner, action: "Run the migration" });
      assert.equal(added.threadId, owner);
      assert.equal(added.createdByThreadId, owner);
      assert.equal(added.state, "open");
      assert.equal(added.threadTitle, "Waiting thread");
      assert.equal(added.projectId, projectA);
      assert.isFalse(added.threadArchived);
      assert.deepEqual((yield* service.list()).tasks, [added]);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("lets a thread add for another thread, which then owns the item", () =>
  Effect.gen(function* () {
    const service = yield* setup;
    const added = yield* service.add({
      actorThreadId: other,
      threadId: owner,
      action: "Approve the deploy",
    });
    assert.equal(added.threadId, owner);
    assert.equal(added.createdByThreadId, other);
    const refused = yield* service
      .update({ actorThreadId: other, taskId: added.id, close: { reason: "mine" } })
      .pipe(Effect.flip);
    assert.include(refused.message, "does not exist");
    const closed = yield* service.update({
      actorThreadId: owner,
      taskId: added.id,
      close: { reason: "Saw it" },
    });
    assert.equal(closed.state, "closed");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects an unknown thread and a deleted thread", () =>
  Effect.gen(function* () {
    const service = yield* setup;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const unknown = yield* service
      .add({ actorThreadId: owner, threadId: ThreadId.make("thread:nope"), action: "x" })
      .pipe(Effect.flip);
    assert.include(unknown.message, "was not found");
    yield* orchestrator.dispatch({
      type: "thread.delete",
      commandId: CommandId.make("delete-other"),
      threadId: other,
    });
    const deleted = yield* service
      .add({ actorThreadId: owner, threadId: other, action: "x" })
      .pipe(Effect.flip);
    assert.include(deleted.message, "was not found");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("updates an item and closes it, for its owning thread only", () =>
  Effect.gen(function* () {
    const service = yield* setup;
    const added = yield* service.add({ actorThreadId: owner, action: "Run the migration" });
    const edited = yield* service.update({
      actorThreadId: owner,
      taskId: added.id,
      action: "Run the migration on staging",
      instructions: "```sh\nnpm run db\n```",
      dueAt: "2026-11-20T09:00:00.000Z",
    });
    assert.equal(edited.action, "Run the migration on staging");
    assert.equal(edited.dueAt, "2026-11-20T09:00:00.000Z");
    const cleared = yield* service.update({ actorThreadId: owner, taskId: added.id, dueAt: null });
    assert.isNull(cleared.dueAt);
    const foreign = yield* service
      .update({ actorThreadId: other, taskId: added.id, action: "Hijack" })
      .pipe(Effect.flip);
    assert.include(foreign.message, "does not exist");
    assert.equal((yield* service.list()).tasks[0]?.action, "Run the migration on staging");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("filters the list by state, project and thread and hides old finished items", () =>
  Effect.gen(function* () {
    const service = yield* setup;
    const first = yield* service.add({ actorThreadId: owner, action: "First" });
    const second = yield* service.add({ actorThreadId: other, action: "Second" });
    yield* service.done({
      commandId: CommandId.make("done-first"),
      threadId: owner,
      taskId: first.id,
    });
    const ids = (input?: Parameters<typeof service.list>[0]) =>
      service.list(input).pipe(Effect.map((result) => result.tasks.map((task) => task.id)));
    assert.deepEqual(yield* ids({ state: "open" }), [second.id]);
    assert.deepEqual(yield* ids({ state: "done" }), [first.id]);
    assert.deepEqual(yield* ids({ projectId: projectB }), [second.id]);
    assert.deepEqual(yield* ids({ threadId: owner }), [first.id]);
    yield* TestClock.adjust("8 days");
    assert.deepEqual(yield* ids(), [second.id]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "hides deleted threads' items, flags archived threads' items and ignores copied ones",
  () =>
    Effect.gen(function* () {
      const service = yield* setup;
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sql = yield* SqlClient.SqlClient;
      const mine = yield* service.add({ actorThreadId: owner, action: "Mine" });
      yield* service.add({ actorThreadId: other, action: "Theirs" });
      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("archive-owner"),
        threadId: owner,
      });
      const archived = (yield* service.list({ threadId: owner })).tasks;
      assert.deepEqual(
        archived.map((task) => [task.id, task.threadArchived]),
        [[mine.id, true]],
      );
      // A payload copied from another thread brings that thread's items along.
      yield* sql`
      UPDATE orchestration_v2_projection_threads
      SET payload_json = json_set(payload_json, '$.operatorTasks',
        (SELECT json_extract(o.payload_json, '$.operatorTasks')
         FROM orchestration_v2_projection_threads AS o WHERE o.thread_id = ${owner}))
      WHERE thread_id = ${other}
    `;
      assert.deepEqual((yield* service.list({ threadId: other })).tasks, []);
      yield* orchestrator.dispatch({
        type: "thread.delete",
        commandId: CommandId.make("delete-owner"),
        threadId: owner,
      });
      assert.deepEqual((yield* service.list()).tasks, []);
    }).pipe(Effect.provide(layerTest)),
);

it.effect("sends one message per Done through the service and reopens an item", () =>
  Effect.gen(function* () {
    const service = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const added = yield* service.add({ actorThreadId: owner, action: "Run the migration" });
    const done = yield* service.done({
      commandId: CommandId.make("click-1"),
      threadId: owner,
      taskId: added.id,
    });
    assert.equal(done.state, "done");
    yield* service.done({
      commandId: CommandId.make("click-1"),
      threadId: owner,
      taskId: added.id,
    });
    yield* service.done({
      commandId: CommandId.make("click-2"),
      threadId: owner,
      taskId: added.id,
    });
    assert.equal(doneCount((yield* projections.getThreadProjection(owner)).messages), 1);
    const reopened = yield* service.reopen({
      commandId: CommandId.make("reopen-1"),
      threadId: owner,
      taskId: added.id,
    });
    assert.equal(reopened.state, "open");
    const missing = yield* service
      .done({
        commandId: CommandId.make("click-3"),
        threadId: owner,
        taskId: "task:missing" as OperatorTaskId,
      })
      .pipe(Effect.flip);
    assert.include(missing.message, "does not exist");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("streams the list, then each change to it, and skips repeats", () =>
  Effect.gen(function* () {
    const service = yield* setup;
    const lists = yield* Queue.unbounded<OperatorTaskListResult>();
    yield* service.subscribeList().pipe(
      Stream.runForEach((list) => Queue.offer(lists, list)),
      Effect.forkChild,
    );
    assert.deepEqual((yield* Queue.take(lists)).tasks, []);
    const added = yield* service.add({ actorThreadId: owner, action: "Run the migration" });
    assert.deepEqual(
      (yield* Queue.take(lists)).tasks.map((task) => task.id),
      [added.id],
    );
    yield* service.done({
      commandId: CommandId.make("click-1"),
      threadId: owner,
      taskId: added.id,
    });
    assert.equal((yield* Queue.take(lists)).tasks[0]?.state, "done");
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.archive",
      commandId: CommandId.make("archive-owner"),
      threadId: owner,
    });
    assert.isTrue((yield* Queue.take(lists)).tasks[0]?.threadArchived);
    assert.isNull(
      yield* Queue.poll(lists).pipe(
        Effect.map((item) => (item._tag === "Some" ? item.value : null)),
      ),
    );
  }).pipe(Effect.provide(layerTest)),
);
