import type { EnvironmentId } from "@t3tools/contracts";
import { act, useLayoutEffect, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({ saved: [] as unknown[] }));

vi.mock("../../state/preferences", () => ({ updateMobilePreferencesAtom: {} }));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomSet: () => (value: unknown) => harness.saved.push(value),
}));

import { HomeListOptionsProvider, useHomeListOptions } from "./home-list-options";

const ENVIRONMENT = "env-1" as EnvironmentId;
const AVAILABLE = new Set([ENVIRONMENT]);

it("saves the scope from every update made in one event", async () => {
  harness.saved = [];
  let controls: ReturnType<typeof useHomeListOptions> | undefined;
  function Probe() {
    const result = useHomeListOptions(AVAILABLE);
    useLayoutEffect(() => {
      controls = result;
    });
    return null;
  }

  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <HomeListOptionsProvider projectGroupingMode="repository">
        <Probe />
      </HomeListOptionsProvider>,
    ),
  );
  act(() => {
    controls!.setSelectedEnvironmentId(ENVIRONMENT);
    controls!.setSelectedProjectKeys(["env-1:project-1"]);
  });

  expect(harness.saved.at(-1)).toEqual({
    threadListFilters: {
      environmentId: ENVIRONMENT,
      projectKeys: ["env-1:project-1"],
      statuses: [],
      accountKey: null,
    },
  });
  expect(controls!.options.selectedEnvironmentId).toBe(ENVIRONMENT);
  expect(controls!.options.selectedProjectKeys).toEqual(["env-1:project-1"]);
  act(() => root.unmount());
});

async function mountOptions(props: {
  readonly enhancedFilterEnabled?: boolean;
  readonly savedFilters?: ComponentProps<typeof HomeListOptionsProvider>["savedFilters"];
}) {
  harness.saved = [];
  const current: { controls?: ReturnType<typeof useHomeListOptions> } = {};
  function Probe() {
    const result = useHomeListOptions(AVAILABLE);
    useLayoutEffect(() => {
      current.controls = result;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () =>
    root.render(
      <HomeListOptionsProvider projectGroupingMode="repository" {...props}>
        <Probe />
      </HomeListOptionsProvider>,
    ),
  );
  return { current, unmount: () => act(() => root.unmount()) };
}

const SAVED = {
  environmentId: ENVIRONMENT,
  projectKeys: ["a", "b"],
  statuses: ["working" as const],
  accountKey: '["env-1","codex"]',
};

it("starts from the saved status, account and projects, and saves each change", async () => {
  const { current, unmount } = await mountOptions({ savedFilters: SAVED });
  expect(current.controls!.options).toMatchObject({
    enhancedFilterEnabled: true,
    selectedProjectKeys: ["a", "b"],
    selectedStatuses: ["working"],
    selectedAccountKey: '["env-1","codex"]',
  });
  act(() => current.controls!.setSelectedStatuses(["input", "working"]));
  expect(harness.saved.at(-1)).toEqual({
    threadListFilters: { ...SAVED, statuses: ["input", "working"] },
  });
  act(() => current.controls!.setSelectedAccountKey(null));
  expect(harness.saved.at(-1)).toMatchObject({
    threadListFilters: { statuses: ["input", "working"], accountKey: null },
  });
  unmount();
});

it("reset clears every filter in one save", async () => {
  const { current, unmount } = await mountOptions({ savedFilters: SAVED });
  act(() => current.controls!.resetFilters());
  expect(harness.saved).toEqual([
    { threadListFilters: { environmentId: null, projectKeys: [], statuses: [], accountKey: null } },
  ]);
  expect(current.controls!.options.selectedProjectKeys).toEqual([]);
  unmount();
});

it("behaves as before while the enhanced filter is off, and keeps the saved choices", async () => {
  const { current, unmount } = await mountOptions({
    enhancedFilterEnabled: false,
    savedFilters: SAVED,
  });
  expect(current.controls!.options).toMatchObject({
    enhancedFilterEnabled: false,
    selectedProjectKeys: ["a"],
    selectedStatuses: [],
    selectedAccountKey: null,
  });
  // A pick replaces the single project and leaves the saved status and account as they were.
  act(() => current.controls!.setSelectedProjectKeys(["c"]));
  expect(harness.saved.at(-1)).toEqual({ threadListFilters: { ...SAVED, projectKeys: ["c"] } });
  unmount();
});
