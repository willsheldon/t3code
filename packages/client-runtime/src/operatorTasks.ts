// @effect-diagnostics globalDate:off - Local calendar days for render-time grouping, outside an Effect runtime.
import { OPERATOR_TASK_RETENTION_MS } from "@t3tools/contracts";
import type { EnvironmentId, OperatorTaskEntry } from "@t3tools/contracts";

export interface EnvironmentOperatorTask {
  readonly environmentId: EnvironmentId;
  readonly task: OperatorTaskEntry;
}

export interface OperatorTaskGroups {
  /** Open items overdue or due before the end of today, soonest first. */
  readonly due: ReadonlyArray<EnvironmentOperatorTask>;
  /** Every other open item, oldest request first. */
  readonly waiting: ReadonlyArray<EnvironmentOperatorTask>;
  /** Items finished in the last seven days, newest first. */
  readonly done: ReadonlyArray<EnvironmentOperatorTask>;
}

const time = (iso: string) => Date.parse(iso);

export function groupOperatorTasks(
  items: ReadonlyArray<EnvironmentOperatorTask>,
  now: Date,
): OperatorTaskGroups {
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const cutoff = now.getTime() - OPERATOR_TASK_RETENTION_MS;
  const due: Array<EnvironmentOperatorTask> = [];
  const waiting: Array<EnvironmentOperatorTask> = [];
  const done: Array<EnvironmentOperatorTask> = [];
  for (const item of items) {
    const { task } = item;
    if (task.state !== "open") {
      if (time(task.updatedAt) > cutoff) done.push(item);
    } else if (task.dueAt !== null && time(task.dueAt) < endOfToday) {
      due.push(item);
    } else {
      waiting.push(item);
    }
  }
  return {
    due: [...due].sort((a, b) => time(a.task.dueAt ?? "") - time(b.task.dueAt ?? "")),
    waiting: [...waiting].sort((a, b) => time(a.task.createdAt) - time(b.task.createdAt)),
    done: [...done].sort((a, b) => time(b.task.updatedAt) - time(a.task.updatedAt)),
  };
}

export function openOperatorTaskCount(items: ReadonlyArray<EnvironmentOperatorTask>): number {
  return items.filter((item) => item.task.state === "open").length;
}
