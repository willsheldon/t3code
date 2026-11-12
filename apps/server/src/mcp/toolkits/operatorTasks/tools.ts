import {
  OperatorTaskAction,
  OperatorTaskCloseReason,
  OperatorTaskDueAt,
  OperatorTaskEntry,
  OperatorTaskInstructions,
  OperatorTaskListInput,
  OperatorTaskListResult,
  OperatorTaskId,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as McpSchema from "effect/ai/McpSchema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as OperatorTaskService from "../../../operatorTasks/OperatorTaskService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  OperatorTaskService.OperatorTaskService,
];

const AddInput = Schema.Struct({
  action: OperatorTaskAction,
  instructions: Schema.optional(OperatorTaskInstructions),
  dueAt: Schema.optional(OperatorTaskDueAt),
  threadId: Schema.optional(
    ThreadId.annotate({ description: "Waiting thread. Default: this one." }),
  ),
});

const UpdateInput = Schema.Struct({
  taskId: OperatorTaskId,
  action: Schema.optional(OperatorTaskAction),
  instructions: Schema.optional(OperatorTaskInstructions),
  dueAt: Schema.optional(Schema.NullOr(OperatorTaskDueAt)).annotate({
    description: "null clears it.",
  }),
  close: Schema.optional(Schema.Struct({ reason: OperatorTaskCloseReason })).annotate({
    description: "Close the item when you see its result yourself.",
  }),
});

const MyTaskAddTool = Tool.make("my_task_add", {
  description:
    "Record an action only the operator can do: a person-only step, or a gate they own. It appears on their My tasks page. Start `action` with a verb. Put steps in `instructions` as Markdown, commands in fenced blocks. When the operator marks it done, a message comes back to the waiting thread. Do not add an item you can do yourself. Check `my_task_list` first and update an existing item instead of adding a second one.",
  parameters: AddInput,
  success: OperatorTaskEntry,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Add a task for the operator")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

const MyTaskUpdateTool = Tool.make("my_task_update", {
  description:
    "Edit one of this thread's open items, or close it with a `reason` once you see the result. Only the waiting thread can change its item. The operator marks items done.",
  parameters: UpdateInput,
  success: OperatorTaskEntry,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Update a task for the operator")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

const MyTaskListTool = Tool.make("my_task_list", {
  description:
    "List the operator's tasks: open ones, and finished ones from the last 7 days. Filter by `state`, `projectId` or `threadId`.",
  parameters: OperatorTaskListInput,
  success: OperatorTaskListResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "List the operator's tasks")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const OperatorTasksToolkit = Toolkit.make(MyTaskAddTool, MyTaskUpdateTool, MyTaskListTool);
