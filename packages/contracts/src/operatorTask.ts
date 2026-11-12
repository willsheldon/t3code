import * as Schema from "effect/Schema";

import { IsoDateTime, OperatorTaskId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

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
/** Done and closed items are kept this long, then dropped on the thread's next task write. */
export const OPERATOR_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
  dueAt: Schema.NullOr(IsoDateTime),
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
