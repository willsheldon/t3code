import { OrchestratorMcpFailure, type OperatorTaskError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as OperatorTaskService from "../../../operatorTasks/OperatorTaskService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { OperatorTasksToolkit } from "./tools.ts";

/** The calling thread. A delegated child reports to its parent, which owns the waiting. */
const callerThread = Effect.fn("OperatorTasksToolkit.callerThread")(function* (operation: string) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const caller = yield* McpInvocationContext.requireThreadScope(scope, operation);
  if (caller.thread.subagent === true) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "A delegated child task reports to its parent. Ask the parent thread to add it.",
    });
  }
  return caller.thread.threadId;
});

const failure = (error: OperatorTaskError) =>
  new OrchestratorMcpFailure({ code: error.reason ?? "invalid_request", message: error.message });

const handlers = {
  my_task_add: McpToolAccess.writesThreads(
    (input) => [input.threadId],
    (input) =>
      Effect.gen(function* () {
        const actorThreadId = yield* callerThread("my_task_add");
        const service = yield* OperatorTaskService.OperatorTaskService;
        return yield* service.add({ ...input, actorThreadId }).pipe(Effect.mapError(failure));
      }),
  ),
  my_task_update: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const actorThreadId = yield* callerThread("my_task_update");
      const service = yield* OperatorTaskService.OperatorTaskService;
      return yield* service
        .update({
          actorThreadId,
          taskId: input.taskId,
          ...(input.action === undefined ? {} : { action: input.action }),
          ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
          ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
          ...(input.close === undefined ? {} : { close: input.close }),
        })
        .pipe(Effect.mapError(failure));
    }),
  ),
  my_task_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const service = yield* OperatorTaskService.OperatorTaskService;
      return yield* service.list(input).pipe(Effect.mapError(failure));
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof OperatorTasksToolkit.tools>;

export const layer = McpToolAccess.toLayer(OperatorTasksToolkit, handlers);
