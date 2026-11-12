import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentOperatorTask } from "@t3tools/client-runtime/operatorTasks";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";

import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { useEnvironments } from "./environments";
import { formatEnvironmentQueryError } from "./query";
import { serverEnvironment } from "./server";

const operatorTasksListAtom = environmentAtomList("web-operator-tasks", (environmentId) =>
  serverEnvironment.operatorTasksLive({ environmentId, input: {} }),
);

export interface OperatorTasksState {
  /** Some connected environment serves operator tasks. Older servers do not. */
  readonly supported: boolean;
  readonly items: ReadonlyArray<EnvironmentOperatorTask>;
  readonly loading: boolean;
  readonly errors: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly message: string;
  }>;
  /** More than one environment serves them, so an item should say where it waits. */
  readonly multipleEnvironments: boolean;
}

/** The operator's tasks from every connected environment that serves them. */
export function useOperatorTasks(): OperatorTasksState {
  const { environments } = useEnvironments();
  const supportedIds = environments.flatMap((environment) =>
    environment.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.operatorTasks === true
      ? [environment.environmentId]
      : [],
  );
  const queries = useAtomValue(operatorTasksListAtom(environmentIdsKey(supportedIds)));
  const items: Array<EnvironmentOperatorTask> = [];
  const errors: Array<{ environmentId: EnvironmentId; message: string }> = [];
  let loading = false;
  queries.forEach((query, index) => {
    const environmentId = supportedIds[index]!;
    const data = AsyncResult.getOrElse(query, () => null);
    if (data === null) {
      if (query._tag === "Failure") {
        errors.push({ environmentId, message: formatEnvironmentQueryError(query.cause) });
      } else {
        loading = true;
      }
      return;
    }
    for (const task of data.tasks) items.push({ environmentId, task });
  });
  return {
    supported: supportedIds.length > 0,
    items,
    loading,
    errors,
    multipleEnvironments: supportedIds.length > 1,
  };
}

/** Done and Reopen need operate permission on the environment that holds the task. */
export function useCanOperateOperatorTasks(environmentId: EnvironmentId): boolean {
  return useAtomValue(serverEnvironment.doneOperatorTask.permissionAtom(environmentId));
}
