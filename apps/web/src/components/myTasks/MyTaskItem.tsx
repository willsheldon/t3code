import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentOperatorTask } from "@t3tools/client-runtime/operatorTasks";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { CommandId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import { newMessageId, randomUUID } from "~/lib/utils";
import { useEnvironment } from "~/state/environments";
import { useProject, useThreadShell } from "~/state/entities";
import { useCanOperateOperatorTasks } from "~/state/operatorTasks";
import { serverEnvironment } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

const dueFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The request failed.";
}

export function MyTaskItem({
  entry,
  showEnvironment,
  now,
}: {
  readonly entry: EnvironmentOperatorTask;
  readonly showEnvironment: boolean;
  readonly now: number;
}) {
  const { environmentId, task } = entry;
  const threadRef = scopeThreadRef(environmentId, task.threadId);
  const project = useProject(scopeProjectRef(environmentId, task.projectId));
  const environment = useEnvironment(environmentId);
  const shell = useThreadShell(threadRef);
  const canOperate = useCanOperateOperatorTasks(environmentId);
  const markDone = useOrchestrationCommand(serverEnvironment.doneOperatorTask, {
    reportFailure: false,
  });
  const reopen = useOrchestrationCommand(serverEnvironment.reopenOperatorTask, {
    reportFailure: false,
  });
  const sendReply = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const replyId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");

  const open = task.state === "open";
  const overdue = open && task.dueAt !== null && Date.parse(task.dueAt) < now;
  const canReply = open && shell !== null && !task.threadArchived;

  const run = async <A, E>(action: () => Promise<AtomCommandResult<A, E>>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result._tag !== "Failure") return true;
    if (!isAtomCommandInterrupted(result))
      setError(failureMessage(squashAtomCommandFailure(result)));
    return false;
  };

  // Each click is a new command, so a failed Done is retried by clicking again.
  const clickAction = (command: typeof markDone) =>
    run(() =>
      command({
        environmentId,
        input: {
          commandId: CommandId.make(randomUUID()),
          threadId: task.threadId,
          taskId: task.id,
        },
      }),
    );

  const submitReply = async () => {
    const text = reply.trim();
    if (text.length === 0 || shell === null) return;
    const sent = await run(() =>
      sendReply({
        environmentId,
        input: {
          threadId: task.threadId,
          message: { messageId: newMessageId(), role: "user", text, attachments: [] },
          runtimeMode: shell.runtimeMode,
          interactionMode: shell.interactionMode,
          dispatchMode: "queue",
          createdAt: new Date().toISOString(),
        },
      }),
    );
    if (sent) {
      setReply("");
      setReplying(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 flex-1 text-sm font-medium break-words">{task.action}</h3>
        {task.dueAt === null ? null : (
          <Badge variant={overdue ? "error" : "outline"}>
            {overdue ? "Overdue " : "Due "}
            {dueFormat.format(new Date(task.dueAt))}
          </Badge>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Link
          className="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline"
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(threadRef)}
        >
          {task.threadTitle}
        </Link>
        {task.threadArchived ? <Badge variant="outline">Thread archived</Badge> : null}
        {project === null ? null : <span>{project.title}</span>}
        {showEnvironment && environment !== null ? <span>{environment.label}</span> : null}
      </p>
      {open && task.instructions.trim().length > 0 ? (
        <ChatMarkdown
          text={task.instructions}
          cwd={undefined}
          environmentId={environmentId}
          className="text-sm"
        />
      ) : null}
      {task.state === "closed" ? (
        <p className="text-xs text-muted-foreground">
          Closed by the thread{task.closeReason === null ? "" : `: ${task.closeReason}`}
        </p>
      ) : null}
      {task.state === "done" && task.doneDelivery !== null && task.doneDelivery !== "queued" ? (
        <p className="text-xs text-muted-foreground">
          {task.doneDelivery === "thread_archived"
            ? "Thread archived, no message sent."
            : "This thread cannot receive messages, no message sent."}
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      )}
      {replying ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={replyId} className="sr-only">
            Reply to the thread
          </label>
          <Textarea
            id={replyId}
            value={reply}
            rows={3}
            placeholder="Message to the waiting thread"
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="compact"
              disabled={busy || reply.trim().length === 0}
              onClick={() => void submitReply()}
            >
              Send
            </Button>
            <Button size="compact" variant="ghost" onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {open ? (
            <>
              <Button
                size="compact"
                disabled={busy || !canOperate}
                onClick={() => void clickAction(markDone)}
              >
                {error === null ? "Done" : "Retry"}
              </Button>
              {canReply && canOperate ? (
                <Button size="compact" variant="outline" onClick={() => setReplying(true)}>
                  Reply
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              size="compact"
              variant="outline"
              disabled={busy || !canOperate}
              onClick={() => void clickAction(reopen)}
            >
              Reopen
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
