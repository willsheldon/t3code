import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  OperatorTaskId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * An operator task is an action that is the operator's to do, recorded by the thread that is
 * waiting for it. The thread projection holds the items; `thread.operator-tasks-updated` carries
 * the whole thread, like `thread.guest-share-updated`.
 */
const OPERATOR_TASK_ACTION_MAX_LENGTH = 200;
const OPERATOR_TASK_INSTRUCTIONS_MAX_LENGTH = 8_000;
const OPERATOR_TASK_CLOSE_REASON_MAX_LENGTH = 500;
/** Open items one thread may hold, so an agent cannot fill the operator's page. */
export const OPERATOR_TASK_OPEN_LIMIT = 50;
/** Items one thread may hold in all. The oldest finished ones go first when a write passes it. */
export const OPERATOR_TASK_TOTAL_LIMIT = 100;
/** Instruction characters one thread may hold across its items. Items ride every thread event. */
export const OPERATOR_TASK_TEXT_LIMIT = 64_000;
/** Done and closed items are kept this long, then dropped on the thread's next task write. */
export const OPERATOR_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const OperatorTaskDueAt = TrimmedNonEmptyString.check(
  Schema.makeFilter(
    (value) =>
      (ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value))) ||
      "Expected an ISO date and time with an offset, such as 2026-11-20T09:00:00Z.",
  ),
).annotate({ description: "When it is due: an ISO date and time with an offset." });

export const OperatorTaskAction = TrimmedNonEmptyString.check(
  Schema.isMaxLength(OPERATOR_TASK_ACTION_MAX_LENGTH),
).annotate({ description: "What the operator must do. Start with a verb." });
export const OperatorTaskInstructions = Schema.String.check(
  Schema.isMaxLength(OPERATOR_TASK_INSTRUCTIONS_MAX_LENGTH),
).annotate({ description: "Markdown steps. Put commands in fenced blocks." });
export const OperatorTaskCloseReason = TrimmedNonEmptyString.check(
  Schema.isMaxLength(OPERATOR_TASK_CLOSE_REASON_MAX_LENGTH),
);

/** `done` is the operator's click. `closed` is the owning thread seeing the result itself. */
export const OperatorTaskState = Schema.Literals(["open", "done", "closed"]);
export type OperatorTaskState = typeof OperatorTaskState.Type;

/** What Done did about telling the thread. Only `queued` sent a message. */
export const OperatorTaskDoneDelivery = Schema.Literals([
  "queued",
  "thread_archived",
  "thread_cannot_receive",
]);
export type OperatorTaskDoneDelivery = typeof OperatorTaskDoneDelivery.Type;

export const OperatorTask = Schema.Struct({
  id: OperatorTaskId,
  /** The waiting thread. It receives the Done message. Its project is the item's project. */
  threadId: ThreadId,
  /** Set by the server from the calling thread. Absent callers record null. */
  createdByThreadId: Schema.NullOr(ThreadId),
  action: OperatorTaskAction,
  instructions: OperatorTaskInstructions,
  dueAt: Schema.NullOr(OperatorTaskDueAt),
  state: OperatorTaskState,
  closeReason: Schema.NullOr(OperatorTaskCloseReason),
  doneAt: Schema.NullOr(IsoDateTime),
  doneDelivery: Schema.NullOr(OperatorTaskDoneDelivery),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OperatorTask = typeof OperatorTask.Type;

/** What the owning thread sees when the operator marks an item done. */
export function operatorTaskDoneMessage(task: Pick<OperatorTask, "action">): string {
  return `The operator marked this task done: ${task.action}`;
}

/** An item with what a list needs from its thread: where it waits, and whether that thread is archived. */
export const OperatorTaskEntry = Schema.Struct({
  ...OperatorTask.fields,
  projectId: ProjectId,
  threadTitle: Schema.String,
  threadArchived: Schema.Boolean,
});
export type OperatorTaskEntry = typeof OperatorTaskEntry.Type;

export const OperatorTaskListInput = Schema.Struct({
  state: Schema.optional(OperatorTaskState),
  projectId: Schema.optional(ProjectId),
  threadId: Schema.optional(ThreadId),
});
export type OperatorTaskListInput = typeof OperatorTaskListInput.Type;

/** Open items, and finished ones from the last seven days. Deleted threads have none. */
export const OperatorTaskListResult = Schema.Struct({ tasks: Schema.Array(OperatorTaskEntry) });
export type OperatorTaskListResult = typeof OperatorTaskListResult.Type;

/** Each click sends a new command id; a retry of the same click sends the same one. */
export const OperatorTaskActionInput = Schema.Struct({
  commandId: CommandId,
  threadId: ThreadId,
  taskId: OperatorTaskId,
});
export type OperatorTaskActionInput = typeof OperatorTaskActionInput.Type;

export class OperatorTaskError extends Schema.TaggedError<OperatorTaskError>()(
  "OperatorTaskError",
  {
    message: Schema.String,
    /** Set when the thread or the item is missing, so callers need not read the message. */
    reason: Schema.optional(Schema.Literals(["thread_not_found", "task_not_found"])),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
