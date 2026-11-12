import {
  EnvironmentId,
  OperatorTaskId,
  ProjectId,
  ThreadId,
  type OperatorTaskEntry,
} from "@t3tools/contracts";
import type { EnvironmentOperatorTask } from "@t3tools/client-runtime/operatorTasks";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  items: [] as ReadonlyArray<EnvironmentOperatorTask>,
  done: vi.fn(),
  reopen: vi.fn(),
  startTurn: vi.fn(),
}));

vi.mock(import("../../state/operatorTasks"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOperatorTasks: () => ({
    supported: true,
    items: state.items,
    loading: false,
    errors: [],
    multipleEnvironments: false,
  }),
  useCanOperateOperatorTasks: () => true,
}));
vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProject: (() => ({ title: "Project A" })) as never,
  useThreadShell: (() => ({ runtimeMode: "full-access", interactionMode: "default" })) as never,
}));
vi.mock(import("../../state/environments"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironment: (() => ({ label: "Laptop" })) as never,
  useEnvironments: (() => ({ environments: [] })) as never,
}));
vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => {
  const { serverEnvironment } = await import("../../state/server");
  return {
    ...(await importOriginal()),
    useOrchestrationCommand: ((command: unknown) =>
      command === serverEnvironment.doneOperatorTask
        ? state.done
        : command === serverEnvironment.reopenOperatorTask
          ? state.reopen
          : state.startTurn) as never,
  };
});
vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  Link: ((props: { children: React.ReactNode }) => <a href="#thread">{props.children}</a>) as never,
}));

import { fakeTimers, render } from "../../../test/render";
import { MyTasksPage } from "./MyTasksPage";

const environmentId = EnvironmentId.make("environment:one");
const hour = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const entry = (id: string, overrides: Partial<OperatorTaskEntry> = {}) => ({
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
    createdAt: iso(-24 * hour),
    updatedAt: iso(-24 * hour),
    projectId: ProjectId.make("project:one"),
    threadTitle: "Waiting thread",
    threadArchived: false,
    ...overrides,
  } satisfies OperatorTaskEntry,
});

/** Freezes the date the page reads, and resets the spies. Acquire it before rendering. */
function setup(items: typeof state.items) {
  const timers = fakeTimers();
  vi.setSystemTime(NOW);
  state.items = items;
  state.done.mockReset().mockResolvedValue({ _tag: "Success" });
  state.reopen.mockReset().mockResolvedValue({ _tag: "Success" });
  state.startTurn.mockReset().mockResolvedValue({ _tag: "Success" });
  return timers;
}

it("groups tasks by when they are due and whether they are finished", async () => {
  using _clock = setup([
    entry("Run the migration", { dueAt: iso(-2 * hour) }),
    entry("Approve the deploy"),
    entry("Rotate the key", { state: "done", updatedAt: iso(-hour), doneAt: iso(-hour) }),
  ]);
  await using _screen = await render(<MyTasksPage />);
  await expect.element(page.getByRole("region", { name: "Due today or overdue" })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "Waiting on you" })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "Done in the last 7 days" })).toBeVisible();
});

it("says so when nothing is waiting", async () => {
  using _clock = setup([]);
  await using _screen = await render(<MyTasksPage />);
  await expect.element(page.getByText("Nothing waiting on you")).toBeVisible();
});

it("sends a new command for each Done click and offers a retry after a failure", async () => {
  using _clock = setup([entry("Run the migration")]);
  state.done.mockResolvedValueOnce({
    _tag: "Failure",
    cause: Cause.fail(new Error("Thread is busy")),
  });
  await using _screen = await render(<MyTasksPage />);
  await userEvent.click(page.getByRole("button", { name: "Done" }));
  await expect.element(page.getByRole("alert")).toHaveTextContent("Thread is busy");
  await userEvent.click(page.getByRole("button", { name: "Retry" }));
  expect(state.done).toHaveBeenCalledTimes(2);
  const [first, second] = state.done.mock.calls.map(([call]) => call.input);
  expect(first).toMatchObject({ threadId: "thread:one", taskId: "Run the migration" });
  expect(second.commandId).not.toBe(first.commandId);
});

it("replies to the waiting thread through the queue and keeps the task open", async () => {
  using _clock = setup([entry("Run the migration")]);
  await using _screen = await render(<MyTasksPage />);
  await userEvent.click(page.getByRole("button", { name: "Reply" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Reply to the thread" }), "Use staging");
  await userEvent.click(page.getByRole("button", { name: "Send" }));
  expect(state.startTurn).toHaveBeenCalledOnce();
  expect(state.startTurn.mock.calls[0]![0].input).toMatchObject({
    threadId: "thread:one",
    dispatchMode: "queue",
    message: { text: "Use staging" },
  });
  expect(state.done).not.toHaveBeenCalled();
  await expect.element(page.getByRole("button", { name: "Done" })).toBeVisible();
});
