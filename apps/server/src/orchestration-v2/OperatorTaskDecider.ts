import {
  MessageId,
  OPERATOR_TASK_OPEN_LIMIT,
  OPERATOR_TASK_RETENTION_MS,
  OPERATOR_TASK_TOTAL_LIMIT,
  type OperatorTask,
  type OperatorTaskDoneDelivery,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  operatorTaskDoneMessage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

export type OperatorTaskCommand = Extract<
  OrchestrationV2ServerCommand,
  {
    readonly type:
      | "thread.operator-task.add"
      | "thread.operator-task.update"
      | "thread.operator-task.done"
      | "thread.operator-task.reopen";
  }
>;

export interface OperatorTaskDecision {
  /** The same object when the command changes nothing, so the caller emits no event. */
  readonly thread: OrchestrationV2AppThread;
  /** The one message Done sends to the waiting thread. Null when nothing is sent. */
  readonly wake: { readonly messageId: MessageId; readonly text: string } | null;
}

const NOT_OPEN = "This task is no longer open.";
const unchanged = (thread: OrchestrationV2AppThread): Result.Result<OperatorTaskDecision, string> =>
  Result.succeed({ thread, wake: null });

/**
 * Applies an operator task command. Commands run one at a time per thread, so checking the item's
 * state here makes a Done click send once and a close stick. Callers set `actorThreadId`; `.done`
 * and `.reopen` carry no actor because only the operator RPC issues them.
 */
export function decideOperatorTaskCommand(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly command: OperatorTaskCommand;
  readonly now: DateTime.Utc;
  /** False for provider-native subagent threads, which take no messages from outside. */
  readonly canReceiveMessage: boolean;
}): Result.Result<OperatorTaskDecision, string> {
  const { thread, command, now } = input;
  const nowIso = DateTime.formatIso(now);
  const tasks = thread.operatorTasks ?? [];
  const task =
    "taskId" in command ? tasks.find((candidate) => candidate.id === command.taskId) : undefined;

  /** Writes the new item list: finished items past the window go, then the oldest past the cap. */
  const write = (next: ReadonlyArray<OperatorTask>, wake: OperatorTaskDecision["wake"] = null) => {
    const cutoff = DateTime.toEpochMillis(now) - OPERATOR_TASK_RETENTION_MS;
    const kept = next.filter(
      (candidate) => candidate.state === "open" || Date.parse(candidate.updatedAt) > cutoff,
    );
    const excess = kept.length - OPERATOR_TASK_TOTAL_LIMIT;
    const dropped = new Set(
      excess > 0
        ? kept
            .filter((candidate) => candidate.state !== "open")
            .toSorted((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
            .slice(0, excess)
            .map((candidate) => candidate.id)
        : [],
    );
    return Result.succeed<OperatorTaskDecision>({
      thread: {
        ...thread,
        operatorTasks: kept.filter((candidate) => !dropped.has(candidate.id)),
      },
      wake,
    });
  };
  const replace = (changed: OperatorTask) =>
    tasks.map((candidate) => (candidate.id === changed.id ? changed : candidate));
  const openCount = tasks.filter((candidate) => candidate.state === "open").length;

  switch (command.type) {
    case "thread.operator-task.add": {
      if (thread.archivedAt !== null) return Result.fail("Archived threads cannot take tasks.");
      if (task !== undefined) return Result.fail(`Task ${command.taskId} already exists.`);
      if (openCount >= OPERATOR_TASK_OPEN_LIMIT) {
        return Result.fail(`A thread can hold ${OPERATOR_TASK_OPEN_LIMIT} open tasks.`);
      }
      return write([
        ...tasks,
        {
          id: command.taskId,
          threadId: thread.id,
          projectId: thread.projectId,
          createdByThreadId: command.createdByThreadId,
          action: command.action,
          instructions: command.instructions ?? "",
          dueAt: command.dueAt ?? null,
          state: "open",
          closeReason: null,
          doneAt: null,
          doneDelivery: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ]);
    }
    case "thread.operator-task.update": {
      if (task === undefined) return Result.fail(`Task ${command.taskId} does not exist.`);
      if (command.actorThreadId !== task.threadId) {
        return Result.fail("Only the thread that owns a task can change it.");
      }
      const edits =
        command.action !== undefined ||
        command.instructions !== undefined ||
        command.dueAt !== undefined;
      if (!edits && command.close === undefined) return Result.fail("Nothing to change.");
      if (task.state !== "open") {
        // The operator got there first, or it was already closed: closing again is not an error.
        return edits ? Result.fail(NOT_OPEN) : unchanged(thread);
      }
      return write(
        replace({
          ...task,
          ...(command.action === undefined ? {} : { action: command.action }),
          ...(command.instructions === undefined ? {} : { instructions: command.instructions }),
          ...(command.dueAt === undefined ? {} : { dueAt: command.dueAt }),
          ...(command.close === undefined
            ? {}
            : { state: "closed" as const, closeReason: command.close.reason }),
          updatedAt: nowIso,
        }),
      );
    }
    case "thread.operator-task.done": {
      if (task === undefined) return Result.fail(`Task ${command.taskId} does not exist.`);
      if (task.state !== "open") return unchanged(thread);
      const doneDelivery: OperatorTaskDoneDelivery =
        thread.archivedAt !== null
          ? "thread_archived"
          : input.canReceiveMessage
            ? "queued"
            : "thread_cannot_receive";
      return write(
        replace({ ...task, state: "done", doneAt: nowIso, doneDelivery, updatedAt: nowIso }),
        doneDelivery === "queued"
          ? {
              // Per click, not per task: Done, Reopen, Done again is a second message.
              messageId: MessageId.make(`message:operator-task-done:${command.commandId}`),
              text: operatorTaskDoneMessage(task),
            }
          : null,
      );
    }
    case "thread.operator-task.reopen": {
      if (task === undefined) return Result.fail(`Task ${command.taskId} does not exist.`);
      if (task.state === "open") return unchanged(thread);
      if (openCount >= OPERATOR_TASK_OPEN_LIMIT) {
        return Result.fail(`A thread can hold ${OPERATOR_TASK_OPEN_LIMIT} open tasks.`);
      }
      return write(
        replace({
          ...task,
          state: "open",
          closeReason: null,
          doneAt: null,
          doneDelivery: null,
          updatedAt: nowIso,
        }),
      );
    }
  }
}
