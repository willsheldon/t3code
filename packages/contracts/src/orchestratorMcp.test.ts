import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  OrchestratorMcpDelegateTaskInput,
  OrchestratorMcpDelegateTaskResult,
  OrchestratorMcpThreadDetail,
} from "./orchestratorMcp.ts";

const decodeDelegateTaskInput = Schema.decodeUnknownSync(OrchestratorMcpDelegateTaskInput);
const decodeDelegateTaskResult = Schema.decodeUnknownSync(OrchestratorMcpDelegateTaskResult);

const decodeThreadDetail = Schema.decodeUnknownSync(OrchestratorMcpThreadDetail);

describe("orchestrator MCP contracts", () => {
  it.each([
    {},
    { lastErrorClass: null, usageLimitResetAt: null },
    { lastErrorClass: "usage_limit", usageLimitResetAt: "2026-10-18T15:23:45.123Z" },
    { lastErrorClass: "provider_error", usageLimitResetAt: null },
  ])("decodes delegated task results with failure metadata %j", (metadata) => {
    const request = decodeDelegateTaskInput({
      task: "Inspect the workspace and report the result.",
      target: {
        providerInstanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
      mode: "wait",
      timeoutMs: 5_000,
      clientRequestId: "delegate-1",
      runtimeMode: "inherit",
      interactionMode: "inherit",
    });
    const result = decodeDelegateTaskResult({
      ...metadata,
      taskId: "node-task-1",
      childThreadId: "thread-child-1",
      childRunId: "run-child-1",
      childNodeId: "node-task-1",
      status: "completed",
      workState: "result_available",
      hasPendingChildRuns: false,
      providerInstanceId: "claudeAgent",
      model: "claude-sonnet-4-6",
      summary: "Workspace inspected.",
      resultContextTransferId: "context-transfer-result-1",
      latestTerminalRunId: "run-child-1",
      latestTerminalStatus: "completed",
      latestTerminalSummary: "Workspace inspected.",
      latestTerminalResultContextTransferId: "context-transfer-result-1",
      hasPendingQuestion: false,
      pendingApproval: null,
      waitTimedOut: false,
    });

    expect(request.target?.providerInstanceId).toBe("claudeAgent");
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("Workspace inspected.");
    expect(result.lastErrorClass).toBe(metadata.lastErrorClass);
    expect(result.usageLimitResetAt).toBe(metadata.usageLimitResetAt);
    expect(result.pendingApproval).toBeNull();
    const pendingApproval = {
      requestId: "request-approval-1",
      kind: "command",
      runId: "run-child-1",
    };
    expect(
      decodeDelegateTaskResult({
        ...result,
        pendingApproval: { ...pendingApproval, input: { command: "private command" } },
      }).pendingApproval,
    ).toEqual(pendingApproval);
    expect(() =>
      decodeDelegateTaskResult({
        ...result,
        pendingApproval: { ...pendingApproval, kind: "user_input" },
      }),
    ).toThrow();
  });
  it.each([
    {},
    { lastErrorClass: null, usageLimitResetAt: null },
    { lastErrorClass: "usage_limit", usageLimitResetAt: "2026-10-18T15:23:45.123Z" },
    { lastErrorClass: "provider_error", usageLimitResetAt: null },
  ])("decodes thread detail with failure metadata %j", (metadata) => {
    const thread = decodeThreadDetail({
      ...metadata,
      threadId: "thread-child-1",
      projectId: "project-1",
      title: "Child",
      createdBy: "agent",
      creationSource: "mcp",
      status: "failed",
      latestRunId: "run-child-1",
      activeRunId: null,
      providerInstanceId: "codex",
      model: "gpt-5.4",
      runtimeMode: "full-access",
      interactionMode: "default",
      linkedPullRequest: null,
      titleRegeneration: null,
      branch: null,
      worktreePath: null,
      parentThreadId: null,
      relationshipToParent: null,
      runCount: 1,
      itemCount: 0,
      pendingRequestCount: 0,
      archived: false,
      settled: false,
      settledAt: null,
      snoozed: false,
      snoozedUntil: null,
      createdAt: "2026-10-18T12:00:00.000Z",
      updatedAt: "2026-10-18T12:00:00.000Z",
    });
    expect(thread.lastErrorClass).toBe(metadata.lastErrorClass);
    expect(thread.usageLimitResetAt).toBe(metadata.usageLimitResetAt);
  });
});
