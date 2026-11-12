import { minuteTick } from "@t3tools/client-runtime/clock";
import {
  groupOperatorTasks,
  type EnvironmentOperatorTask,
} from "@t3tools/client-runtime/operatorTasks";
import { ListChecksIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { isElectron } from "~/env";
import { useEnvironments } from "~/state/environments";
import { useOperatorTasks } from "~/state/operatorTasks";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { MyTaskItem } from "./MyTaskItem";

function TaskGroup({
  title,
  items,
  showEnvironment,
  now,
}: {
  readonly title: string;
  readonly items: ReadonlyArray<EnvironmentOperatorTask>;
  readonly showEnvironment: boolean;
  readonly now: number;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title} <span className="tabular-nums">{items.length}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((entry) => (
          <MyTaskItem
            key={`${entry.environmentId}:${entry.task.id}`}
            entry={entry}
            showEnvironment={showEnvironment}
            now={now}
          />
        ))}
      </ul>
    </section>
  );
}

export function MyTasksPage() {
  const { supported, items, loading, errors, multipleEnvironments } = useOperatorTasks();
  const { environments } = useEnvironments();
  const minute = useSyncExternalStore(minuteTick.subscribe, minuteTick.getSnapshot);
  const now = Date.parse(`${minute}:00Z`);
  const groups = groupOperatorTasks(items, new Date(now));
  const shown = groups.due.length + groups.waiting.length + groups.done.length;
  const labelOf = (environmentId: string) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    environmentId;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} className="relative bg-background">
        <WorkspaceBreadcrumb ariaLabel="My tasks breadcrumb">
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate">My tasks</h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6">
          {errors.map((error) => (
            <p
              key={error.environmentId}
              role="alert"
              className="text-sm text-destructive-foreground"
            >
              Could not load tasks from {labelOf(error.environmentId)}: {error.message}
            </p>
          ))}
          {loading && shown === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading tasks…
            </p>
          ) : null}
          {shown === 0 && !loading && errors.length === 0 ? (
            <Empty size="compact">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListChecksIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {supported ? "Nothing waiting on you" : "Tasks are not available"}
                </EmptyTitle>
                <EmptyDescription>
                  {supported
                    ? "When a thread needs you to do something, it shows up here."
                    : "Connect an environment that supports tasks."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          <TaskGroup
            title="Due today or overdue"
            items={groups.due}
            showEnvironment={multipleEnvironments}
            now={now}
          />
          <TaskGroup
            title="Waiting on you"
            items={groups.waiting}
            showEnvironment={multipleEnvironments}
            now={now}
          />
          <TaskGroup
            title="Done in the last 7 days"
            items={groups.done}
            showEnvironment={multipleEnvironments}
            now={now}
          />
        </div>
      </main>
    </SidebarInset>
  );
}
