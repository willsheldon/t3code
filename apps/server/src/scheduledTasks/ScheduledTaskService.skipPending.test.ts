import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  type ScheduledTaskId as ScheduledTaskIdType,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const PROJECT = ProjectId.make("project:skip-pending");
const THREAD = ThreadId.make("thread:skip-pending");
const TASK = ScheduledTaskId.make("task:skip-pending");
const EVERY_MS = 60_000;

interface FakeRun {
  readonly id: string;
  readonly status: "queued" | "running";
  readonly scheduledTaskId: ScheduledTaskIdType | undefined;
}

/** A busy thread: it keeps every queued run and starts none until the test says so. */
const harness = Effect.gen(function* () {
  const runs = yield* Ref.make<ReadonlyArray<FakeRun>>([]);
  const sends = yield* Ref.make(0);
  const due = yield* Ref.make<Effect.Effect<void>>(Effect.void);
  const lookupFails = yield* Ref.make(false);
  const layer = ScheduledTaskService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ManagedPolicy.layerTest(),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({ projectId: PROJECT, archivedAt: null, deletedAt: null } as never),
          sendToThread: (input) =>
            Ref.update(sends, (n) => n + 1).pipe(
              Effect.andThen(
                Ref.update(runs, (all): ReadonlyArray<FakeRun> => [
                  ...all,
                  {
                    id: `run:${all.length}`,
                    status: "queued",
                    scheduledTaskId: input.scheduledTaskId,
                  },
                ]),
              ),
              Effect.as({} as never),
            ),
          getProjectThreadRecords: ((_input: unknown, _fields: unknown, filter: any) =>
            Ref.get(lookupFails).pipe(
              Effect.flatMap((fails) =>
                fails
                  ? Effect.fail(
                      new ThreadManagementService.ThreadManagementThreadNotFoundError({
                        projectId: PROJECT,
                        threadId: THREAD,
                      }),
                    )
                  : Ref.get(runs),
              ),
              Effect.map((all) => {
                const matching = all.filter(
                  (run) =>
                    filter?.runStatuses === undefined || filter.runStatuses.includes(run.status),
                );
                return {
                  runs: matching.map((run) => ({ id: run.id, status: run.status })),
                  messages: all
                    .filter(
                      (run) =>
                        filter?.messageRunIds === undefined ||
                        filter.messageRunIds.includes(run.id),
                    )
                    .map((run) => ({
                      id: `message:${run.id}`,
                      runId: run.id,
                      role: "user",
                      scheduledTaskId: run.scheduledTaskId,
                    })),
                };
              }),
            )) as never,
        }),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
        }),
        NodeCrypto.layer,
        Layer.succeed(Scheduler.Scheduler, {
          // The service registers other pollers too; only the schedule poller matters here.
          register: <E, R>(name: string, runDueWork: Effect.Effect<void, E, R>) =>
            name === "scheduled-tasks"
              ? Effect.context<R>().pipe(
                  Effect.flatMap((context) =>
                    Ref.set(due, runDueWork.pipe(Effect.provideContext(context), Effect.orDie)),
                  ),
                )
              : Effect.void,
        }),
      ),
    ),
  );
  return { runs, sends, due, lookupFails, layer };
});

const createTask = (everyMs = EVERY_MS) =>
  Effect.gen(function* () {
    const service = yield* ScheduledTaskService.ScheduledTaskService;
    return yield* service.upsert({
      id: TASK,
      title: "Check in",
      prompt: "Check progress",
      enabled: true,
      schedule: { type: "interval", everyMs },
      projectId: PROJECT,
      threadId: THREAD,
      workspaceStrategy: { type: "root" },
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
    });
  });

/** Moves the clock one interval ahead, then runs the due-task pass the scheduler would run. */
const fire = (due: Ref.Ref<Effect.Effect<void>>) =>
  TestClock.adjust(EVERY_MS).pipe(Effect.andThen(Ref.get(due)), Effect.flatten);

const onlyTask = Effect.gen(function* () {
  const service = yield* ScheduledTaskService.ScheduledTaskService;
  const [task] = (yield* service.list()).tasks;
  if (task === undefined) return yield* Effect.die("task missing");
  return task;
});

it.effect("a schedule bound to a busy thread never queues more than one run of its own", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-10T00:00:00.000Z"));
    const { sends, due, layer } = yield* harness;
    yield* Effect.gen(function* () {
      yield* createTask();
      let previousNext: string | null = null;
      for (let i = 0; i < 3; i++) {
        yield* fire(due);
        const task = yield* onlyTask;
        // Every firing, sent or skipped, moves the schedule forward.
        assert.isNotNull(task.nextRunAt);
        assert.notEqual(task.nextRunAt, previousNext);
        previousNext = task.nextRunAt;
      }
      assert.equal(yield* Ref.get(sends), 1);
      const task = yield* onlyTask;
      assert.equal(task.lastRunStatus, "skipped-pending");
      // Skips are not runs.
      assert.equal(task.runCount, 1);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("queued runs from users or other schedules do not block a firing", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-10T00:00:00.000Z"));
    const { runs, sends, due, layer } = yield* harness;
    yield* Ref.set(runs, [
      { id: "run:user", status: "queued", scheduledTaskId: undefined },
      { id: "run:other", status: "queued", scheduledTaskId: ScheduledTaskId.make("task:other") },
    ]);
    yield* Effect.gen(function* () {
      yield* createTask();
      yield* fire(due);
      assert.equal(yield* Ref.get(sends), 1);
      assert.equal((yield* onlyTask).lastRunStatus, "succeeded");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a started run from the schedule does not count as pending", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-10T00:00:00.000Z"));
    const { runs, sends, due, layer } = yield* harness;
    yield* Ref.set(runs, [{ id: "run:started", status: "running", scheduledTaskId: TASK }]);
    yield* Effect.gen(function* () {
      yield* createTask();
      yield* fire(due);
      assert.equal(yield* Ref.get(sends), 1);
      assert.equal((yield* onlyTask).lastRunStatus, "succeeded");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("the schedule queues again once its pending run has started", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-10T00:00:00.000Z"));
    const { runs, sends, due, layer } = yield* harness;
    yield* Effect.gen(function* () {
      yield* createTask();
      yield* fire(due);
      yield* fire(due);
      assert.equal(yield* Ref.get(sends), 1);
      // The thread's active run ended and the queued one began.
      yield* Ref.update(runs, (all) => all.map((run) => ({ ...run, status: "running" as const })));
      yield* fire(due);
      assert.equal(yield* Ref.get(sends), 2);
      assert.equal((yield* onlyTask).lastRunStatus, "succeeded");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a manual run is not skipped by a pending scheduled run", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-10T00:00:00.000Z"));
    const { sends, due, layer } = yield* harness;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      yield* createTask();
      yield* fire(due);
      yield* service.runNow({ id: TASK });
      assert.equal(yield* Ref.get(sends), 2);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("a failed queue lookup still sends the firing", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-11-10T00:00:00.000Z"));
    const { sends, due, lookupFails, layer } = yield* harness;
    yield* Ref.set(lookupFails, true);
    yield* Effect.gen(function* () {
      yield* createTask();
      yield* fire(due);
      assert.equal(yield* Ref.get(sends), 1);
      assert.equal((yield* onlyTask).lastRunStatus, "succeeded");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
