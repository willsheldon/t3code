import {
  CommandId,
  OPERATOR_TASK_RETENTION_MS,
  OperatorTaskError,
  OperatorTaskId,
  type OperatorTaskActionInput,
  type OperatorTaskEntry,
  type OperatorTaskListInput,
  OperatorTaskListResult,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2StoredEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";

type OperatorTaskCommand = Extract<
  OrchestrationV2ServerCommand,
  { readonly type: `thread.operator-task.${string}` }
>;

interface AddInput {
  /** The thread asking. It may add for another thread, which then owns the item. */
  readonly actorThreadId: ThreadId;
  readonly threadId?: ThreadId | undefined;
  readonly action: string;
  readonly instructions?: string | undefined;
  readonly dueAt?: string | null | undefined;
}

interface UpdateInput {
  /** Only the thread that owns the item may change it, so this is also the item's thread. */
  readonly actorThreadId: ThreadId;
  readonly taskId: OperatorTaskId;
  readonly action?: string | undefined;
  readonly instructions?: string | undefined;
  readonly dueAt?: string | null | undefined;
  readonly close?: { readonly reason: string } | undefined;
}

export class OperatorTaskService extends Context.Service<
  OperatorTaskService,
  {
    readonly list: (
      input?: OperatorTaskListInput,
    ) => Effect.Effect<OperatorTaskListResult, OperatorTaskError>;
    /** The list now, then the list again after each change to it. Repeats are skipped. */
    readonly subscribeList: () => Stream.Stream<OperatorTaskListResult, OperatorTaskError>;
    readonly add: (input: AddInput) => Effect.Effect<OperatorTaskEntry, OperatorTaskError>;
    readonly update: (input: UpdateInput) => Effect.Effect<OperatorTaskEntry, OperatorTaskError>;
    readonly done: (
      input: OperatorTaskActionInput,
    ) => Effect.Effect<OperatorTaskEntry, OperatorTaskError>;
    readonly reopen: (
      input: OperatorTaskActionInput,
    ) => Effect.Effect<OperatorTaskEntry, OperatorTaskError>;
  }
>()("t3/operatorTasks/OperatorTaskService") {}

const encodeListJson = Schema.encodeEffect(Schema.fromJsonString(OperatorTaskListResult));

const failure = (
  message: string,
  cause?: unknown,
  reason?: "thread_not_found" | "task_not_found",
) =>
  new OperatorTaskError({
    message,
    ...(reason === undefined ? {} : { reason }),
    ...(cause === undefined ? {} : { cause }),
  });

/** Events that change what the list shows: its items, or the thread fields it joins. */
const affectsList = ({ event }: OrchestrationV2StoredEvent): boolean => {
  switch (event.type) {
    case "thread.operator-tasks-updated":
      return true;
    case "thread.archived":
    case "thread.unarchived":
    case "thread.deleted":
    case "thread.metadata-updated":
      return (event.payload.operatorTasks?.length ?? 0) > 0;
    default:
      return false;
  }
};

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const random = yield* SecureRandom.SecureRandom;

  const newId = (prefix: string) =>
    random.uuidV4().pipe(
      Effect.orDie,
      Effect.map((uuid) => `${prefix}:${uuid}`),
    );

  const list: OperatorTaskService["Service"]["list"] = Effect.fn("OperatorTaskService.list")(
    function* (input) {
      const rows = yield* projections
        .listOperatorTasks()
        .pipe(Effect.mapError((cause) => failure("Could not list your tasks.", cause)));
      const cutoff = DateTime.toEpochMillis(yield* DateTime.now) - OPERATOR_TASK_RETENTION_MS;
      const tasks = rows
        .filter(
          ({ task, projectId }) =>
            (task.state === "open" || Date.parse(task.updatedAt) > cutoff) &&
            (input?.state === undefined || task.state === input.state) &&
            (input?.projectId === undefined || projectId === input.projectId) &&
            (input?.threadId === undefined || task.threadId === input.threadId),
        )
        .map(({ task, projectId, threadTitle, threadArchived }): OperatorTaskEntry => ({
          ...task,
          projectId,
          threadTitle,
          threadArchived,
        }))
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      return { tasks };
    },
  );

  const encodeList = (result: OperatorTaskListResult) =>
    encodeListJson(result).pipe(
      Effect.mapError((cause) => failure("Could not follow your tasks.", cause)),
    );

  const subscribeList: OperatorTaskService["Service"]["subscribeList"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Read the cursor first: events after it are replayed, so no change falls in the gap.
        const after = yield* eventSink
          .latestSequence()
          .pipe(Effect.mapError((cause) => failure("Could not follow your tasks.", cause)));
        const first = yield* list();
        const last = yield* Ref.make(yield* encodeList(first));
        const changes = eventSink.stream({ afterSequence: after, bounded: true }).pipe(
          Stream.mapError((cause) => failure("Could not follow your tasks.", cause)),
          Stream.filter(affectsList),
          Stream.mapEffect(() => list()),
          Stream.filterEffect((next) =>
            encodeList(next).pipe(
              Effect.flatMap((encoded) =>
                Ref.modify(last, (previous) => [previous !== encoded, encoded]),
              ),
            ),
          ),
        );
        return Stream.concat(Stream.succeed(first), changes);
      }),
    );

  const entryOf = Effect.fn("OperatorTaskService.entryOf")(function* (
    threadId: ThreadId,
    taskId: OperatorTaskId,
  ) {
    const { tasks } = yield* list({ threadId });
    const entry = tasks.find((candidate) => candidate.id === taskId);
    return entry ?? (yield* failure(`Task ${taskId} does not exist.`, undefined, "task_not_found"));
  });

  const dispatch = (command: OperatorTaskCommand) =>
    orchestrator
      .dispatch(command)
      .pipe(
        Effect.mapError((error) =>
          "cause" in error && typeof error.cause === "string" && error.cause.length > 0
            ? failure(error.cause, error)
            : failure("Could not change the task.", error),
        ),
      );

  const requireLiveThread = Effect.fn("OperatorTaskService.requireLiveThread")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* projections
      .getThreadShell(threadId)
      .pipe(Effect.mapError((cause) => failure("Could not read the thread.", cause)));
    if (shell === null || shell.deletedAt !== null) {
      return yield* failure(`Thread ${threadId} was not found.`, undefined, "thread_not_found");
    }
  });

  /** Fails early and plainly for an id that is not this thread's, as for one that never existed. */
  const requireTask = Effect.fn("OperatorTaskService.requireTask")(function* (
    threadId: ThreadId,
    taskId: OperatorTaskId,
  ) {
    yield* requireLiveThread(threadId);
    const thread = yield* projections
      .getThread(threadId)
      .pipe(Effect.mapError((cause) => failure("Could not read the thread.", cause)));
    if (
      !(thread.operatorTasks ?? []).some((task) => task.id === taskId && task.threadId === threadId)
    ) {
      return yield* failure(`Task ${taskId} does not exist.`, undefined, "task_not_found");
    }
  });

  const add: OperatorTaskService["Service"]["add"] = Effect.fn("OperatorTaskService.add")(
    function* (input) {
      const threadId = input.threadId ?? input.actorThreadId;
      yield* requireLiveThread(threadId);
      const taskId = OperatorTaskId.make(yield* newId("task"));
      yield* dispatch({
        type: "thread.operator-task.add",
        commandId: CommandId.make(yield* newId("server:operator-task-add")),
        threadId,
        taskId,
        action: input.action,
        ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
        ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
        createdByThreadId: input.actorThreadId,
      });
      return yield* entryOf(threadId, taskId);
    },
  );

  const update: OperatorTaskService["Service"]["update"] = Effect.fn("OperatorTaskService.update")(
    function* (input) {
      yield* requireTask(input.actorThreadId, input.taskId);
      yield* dispatch({
        type: "thread.operator-task.update",
        commandId: CommandId.make(yield* newId("server:operator-task-update")),
        threadId: input.actorThreadId,
        taskId: input.taskId,
        actorThreadId: input.actorThreadId,
        ...(input.action === undefined ? {} : { action: input.action }),
        ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
        ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
        ...(input.close === undefined ? {} : { close: input.close }),
      });
      return yield* entryOf(input.actorThreadId, input.taskId);
    },
  );

  const operatorAction =
    (type: "thread.operator-task.done" | "thread.operator-task.reopen") =>
    (input: OperatorTaskActionInput) =>
      requireTask(input.threadId, input.taskId).pipe(
        Effect.andThen(dispatch({ type, ...input })),
        Effect.andThen(entryOf(input.threadId, input.taskId)),
      );

  return OperatorTaskService.of({
    list,
    subscribeList,
    add,
    update,
    done: Effect.fn("OperatorTaskService.done")(operatorAction("thread.operator-task.done")),
    reopen: Effect.fn("OperatorTaskService.reopen")(operatorAction("thread.operator-task.reopen")),
  });
});

export const layer = Layer.effect(OperatorTaskService, make);
