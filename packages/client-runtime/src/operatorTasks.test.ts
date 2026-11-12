// @effect-diagnostics globalDate:off - Local calendar days for render-time grouping, outside an Effect runtime.
import { EnvironmentId, OperatorTaskId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { OperatorTaskEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupOperatorTasks,
  openOperatorTaskCount,
  type EnvironmentOperatorTask,
} from "./operatorTasks.ts";

const environmentId = EnvironmentId.make("environment:one");
// Local time, so "today" means the operator's day whatever the test host's zone.
const now = new Date(2026, 10, 12, 15, 0, 0);
const at = (days: number, hour: number, minute = 0) =>
  new Date(2026, 10, 12 + days, hour, minute, 0).toISOString();

const item = (id: string, overrides: Partial<OperatorTaskEntry> = {}): EnvironmentOperatorTask => ({
  environmentId,
  task: {
    id: OperatorTaskId.make(id),
    threadId: ThreadId.make("thread:one"),
    createdByThreadId: null,
    action: id,
    instructions: "",
    dueAt: null,
    state: "open",
    closeReason: null,
    doneAt: null,
    doneDelivery: null,
    createdAt: at(-3, 9),
    updatedAt: at(-3, 9),
    projectId: ProjectId.make("project:one"),
    threadTitle: "Thread",
    threadArchived: false,
    ...overrides,
  },
});
const ids = (items: ReadonlyArray<EnvironmentOperatorTask>) => items.map((entry) => entry.task.id);

describe("groupOperatorTasks", () => {
  it("puts overdue and due-today items first, soonest first, and the rest under waiting", () => {
    const groups = groupOperatorTasks(
      [
        item("later-today", { dueAt: at(0, 23, 30) }),
        item("tomorrow", { dueAt: at(1, 0, 30) }),
        item("overdue", { dueAt: at(-2, 9) }),
        item("no-deadline", { createdAt: at(-1, 9) }),
        item("older-no-deadline", { createdAt: at(-5, 9) }),
      ],
      now,
    );
    expect(ids(groups.due)).toEqual(["overdue", "later-today"]);
    // Waiting runs by the age of the request, not by deadline.
    expect(ids(groups.waiting)).toEqual(["older-no-deadline", "tomorrow", "no-deadline"]);
    expect(groups.done).toEqual([]);
  });

  it("lists items finished in the last seven days, newest first, and drops older ones", () => {
    const groups = groupOperatorTasks(
      [
        item("done-old", { state: "done", updatedAt: at(-8, 12), doneAt: at(-8, 12) }),
        item("done-new", { state: "done", updatedAt: at(-1, 12), doneAt: at(-1, 12) }),
        item("closed", { state: "closed", closeReason: "Saw it", updatedAt: at(0, 9) }),
        item("done-edge", { state: "done", updatedAt: at(-6, 16), doneAt: at(-6, 16) }),
      ],
      now,
    );
    expect(ids(groups.done)).toEqual(["closed", "done-new", "done-edge"]);
    expect(groups.due).toEqual([]);
    expect(groups.waiting).toEqual([]);
  });

  it("keeps a finished item out of the due group even with a past deadline", () => {
    const groups = groupOperatorTasks(
      [item("finished", { state: "done", dueAt: at(-2, 9), updatedAt: at(0, 9) })],
      now,
    );
    expect(ids(groups.done)).toEqual(["finished"]);
    expect(groups.due).toEqual([]);
  });
});

describe("openOperatorTaskCount", () => {
  it("counts open items across environments and ignores finished ones", () => {
    const other = { ...item("other"), environmentId: EnvironmentId.make("environment:two") };
    expect(
      openOperatorTaskCount([
        item("a"),
        other,
        item("b", { state: "done" }),
        item("c", { state: "closed" }),
      ]),
    ).toBe(2);
  });
});
