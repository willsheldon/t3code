import { isLatestRunSettled } from "@t3tools/client-runtime/state/models";
import {
  resolveThreadFilterStatus,
  type ThreadFilterStatus,
  type ThreadFilterStatusInput,
} from "@t3tools/client-runtime/state/thread-filters";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadStatusPill } from "../Sidebar.logic";

/** The pill-based grouping the web sidebar used before the shared function replaced it. */
function pillStatusFilter(thread: ThreadFilterStatusInput): ThreadFilterStatus | null {
  switch (resolveThreadStatusPill({ thread })?.label) {
    case "Pending Approval":
    case "Awaiting Input":
    case "Guest Request":
    case "Plan Ready":
      return "input";
    case "Working":
    case "Connecting":
    case "Waiting":
      return "working";
    case "Failed":
      return "failed";
    case "Completed":
      return "done";
    case undefined:
      return thread.latestRun?.status !== "failed" &&
        isLatestRunSettled(thread.latestRun, thread.runtime)
        ? "done"
        : null;
  }
}

const RUN_ID = "run-1";
const requests: ReadonlyArray<Partial<ThreadFilterStatusInput>> = [
  {},
  { hasPendingApprovals: true },
  { hasPendingUserInput: true },
  { pendingSubagentRequest: "approval" },
  { pendingSubagentRequest: "user_input" },
  { pendingGuestMessageCount: 2 },
];
const runtimes = [
  null,
  ...(
    [
      "idle",
      "preparing",
      "queued",
      "starting",
      "running",
      "waiting",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ] as const
  ).flatMap((status) => [
    { status, activeRunId: null },
    { status, activeRunId: RUN_ID },
  ]),
] as unknown as ReadonlyArray<ThreadFilterStatusInput["runtime"]>;
const latestRuns = [
  null,
  ...(
    [
      "preparing",
      "queued",
      "starting",
      "running",
      "waiting",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
      "rolled_back",
    ] as const
  ).flatMap((status) => [
    { runId: RUN_ID, status, startedAt: "2026-01-01T00:00:00.000Z", completedAt: null },
    {
      runId: RUN_ID,
      status,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-02T00:00:00.000Z",
    },
  ]),
  { runId: RUN_ID, status: "completed", startedAt: null, completedAt: "not a date" },
  { runId: RUN_ID, status: "failed", startedAt: null, completedAt: "not a date" },
] as unknown as ReadonlyArray<ThreadFilterStatusInput["latestRun"]>;
// Before, at and after the 2026-01-02 completion; never visited; unsupported by the server; unparsable.
const visits = [
  undefined,
  null,
  "2026-01-01T12:00:00.000Z",
  "2026-01-02T00:00:00.000Z",
  "2026-01-03T00:00:00.000Z",
  "not a date",
];
const backgroundTasks = [
  [],
  [{ kind: "command", awaited: false }],
  [{ kind: "command", awaited: true }],
  [{ kind: "subagent", awaited: false }],
  [{ kind: "background_task", awaited: false }],
] as unknown as ReadonlyArray<ThreadFilterStatusInput["pendingBackgroundTasks"]>;
const plans = [
  { interactionMode: "default", hasActionableProposedPlan: false },
  { interactionMode: "plan", hasActionableProposedPlan: false },
  { interactionMode: "plan", hasActionableProposedPlan: true },
  { interactionMode: "default", hasActionableProposedPlan: true },
] as const;

describe("shared thread filter status", () => {
  it("agrees with the sidebar status pill on every thread state", () => {
    const disagreements: string[] = [];
    let checked = 0;
    const seen = new Set<ThreadFilterStatus | null>();
    for (const request of requests) {
      for (const runtime of runtimes) {
        for (const blockedOnThreadWait of [false, true]) {
          for (const pendingBackgroundTasks of backgroundTasks) {
            for (const latestRun of latestRuns) {
              for (const lastVisitedAt of visits) {
                for (const plan of plans) {
                  const thread: ThreadFilterStatusInput = {
                    hasPendingApprovals: false,
                    hasPendingUserInput: false,
                    pendingSubagentRequest: null,
                    pendingGuestMessageCount: 0,
                    latestRun,
                    runtime,
                    blockedOnThreadWait,
                    pendingBackgroundTasks,
                    lastVisitedAt,
                    ...plan,
                    ...request,
                  };
                  const expected = pillStatusFilter(thread);
                  const actual = resolveThreadFilterStatus(thread);
                  checked += 1;
                  seen.add(actual);
                  if (actual !== expected && disagreements.length < 5) {
                    disagreements.push(
                      `${JSON.stringify(thread)} -> pill ${expected}, shared ${actual}`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
    expect(checked).toBeGreaterThan(50_000);
    expect(seen).toEqual(new Set(["input", "working", "failed", "done", null]));
  });

  it("omits optional fields older servers leave out, as the pill does", () => {
    const thread: ThreadFilterStatusInput = {
      hasActionableProposedPlan: false,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      interactionMode: "default",
      latestRun: null,
      runtime: null,
    };
    expect(resolveThreadFilterStatus(thread)).toBe(pillStatusFilter(thread));
  });
});
