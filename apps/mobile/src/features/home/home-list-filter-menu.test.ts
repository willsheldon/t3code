import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  applyHomeListFilterAction,
  buildHomeListFilterMenu,
  buildHomeListFilterSheet,
  buildHomeListFilterSections,
  homeListFilterActiveCount,
  homeListFilterButtonLabel,
  homeListFilterChipAccessibilityLabels,
  homeListFilterMenuActions,
  homeListFilterSubmenuActions,
  isHomeListFilterCustomized,
  projectFilterLabel,
  type HomeListFilterMenuEnhanced,
  type HomeListFilterMenuState,
} from "./home-list-filter-menu";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");

const ENHANCED: HomeListFilterMenuEnhanced = {
  statuses: [],
  statusCounts: { input: 1, working: 3, failed: 0, done: 40 },
  doneHasMore: false,
  accountOptions: [
    { key: '["env-a","codex"]', label: "Codex" },
    { key: '["env-b","claude"]', label: "Claude" },
  ],
  selectedAccountKey: null,
};

function state(overrides: Partial<HomeListFilterMenuState> = {}): HomeListFilterMenuState {
  return {
    environments: [
      { environmentId: ENV_A, label: "Laptop" },
      { environmentId: ENV_B, label: "Server" },
    ],
    selectedEnvironmentId: null,
    projects: [
      { key: "alpha", label: "Alpha" },
      { key: "beta", label: "Beta" },
    ],
    selectedProjectKeys: [],
    enhanced: ENHANCED,
    ...overrides,
  };
}

const section = (menu: HomeListFilterMenuState, id: string) =>
  buildHomeListFilterSections(menu).find((candidate) => candidate.id === id);

function handlers() {
  return {
    onEnvironmentChange: vi.fn(),
    onProjectsChange: vi.fn(),
    onStatusesChange: vi.fn(),
    onAccountChange: vi.fn(),
    onReset: vi.fn(),
  };
}

describe("status menu", () => {
  it("lists the four statuses with a count each and keeps the menu open for the next tap", () => {
    const status = section(state(), "status");
    expect(status?.title).toBe("Status");
    expect(status?.entries).toEqual([
      {
        id: "status:input",
        title: "Input",
        subtitle: "1 thread",
        state: "off",
        keepsMenuPresented: true,
      },
      {
        id: "status:working",
        title: "Working",
        subtitle: "3 threads",
        state: "off",
        keepsMenuPresented: true,
      },
      {
        id: "status:failed",
        title: "Failed",
        subtitle: "0 threads",
        state: "off",
        keepsMenuPresented: true,
      },
      {
        id: "status:done",
        title: "Done",
        subtitle: "40 threads",
        state: "off",
        keepsMenuPresented: true,
      },
    ]);
  });

  it("marks selected statuses and offers Clear status only then", () => {
    const status = section(
      state({ enhanced: { ...ENHANCED, statuses: ["working", "done"] } }),
      "status",
    );
    expect(status?.entries.map((entry) => [entry.id, entry.state])).toEqual([
      ["status:input", "off"],
      ["status:working", "on"],
      ["status:failed", "off"],
      ["status:done", "on"],
      ["status:clear", undefined],
    ]);
    expect(status?.entries.at(-1)?.title).toBe("Clear status");
  });

  it("shows a lower bound for Done while older settled threads are not loaded", () => {
    const status = section(state({ enhanced: { ...ENHANCED, doneHasMore: true } }), "status");
    expect(status?.entries.find((entry) => entry.id === "status:done")?.subtitle).toBe(
      "40+ threads",
    );
    expect(status?.entries.find((entry) => entry.id === "status:input")?.subtitle).toBe("1 thread");
  });

  it("leaves the subtitles out until counted", () => {
    const status = section(state({ enhanced: { ...ENHANCED, statusCounts: null } }), "status");
    expect(status?.entries.every((entry) => entry.subtitle === undefined)).toBe(true);
  });

  it("toggles one status at a time, in canonical order", () => {
    const menu = state({ enhanced: { ...ENHANCED, statuses: ["done"] } });
    const actions = handlers();
    applyHomeListFilterAction("status:input", menu, actions);
    expect(actions.onStatusesChange).toHaveBeenLastCalledWith(["input", "done"]);
    applyHomeListFilterAction("status:done", menu, actions);
    expect(actions.onStatusesChange).toHaveBeenLastCalledWith([]);
    applyHomeListFilterAction("status:clear", menu, actions);
    expect(actions.onStatusesChange).toHaveBeenLastCalledWith([]);
    applyHomeListFilterAction("status:bogus", menu, actions);
    expect(actions.onStatusesChange).toHaveBeenCalledTimes(3);
  });
});

describe("account menu", () => {
  it("appears with more than one account", () => {
    const account = section(state(), "account");
    expect(account?.entries.map((entry) => [entry.title, entry.state])).toEqual([
      ["All accounts", "on"],
      ["Codex", "off"],
      ["Claude", "off"],
    ]);
  });

  it("is left out with a single account and nothing selected", () => {
    const one = state({ enhanced: { ...ENHANCED, accountOptions: [ENHANCED.accountOptions[0]!] } });
    expect(section(one, "account")).toBeUndefined();
  });

  it("stays with one account when it is the selected one, and names a missing account", () => {
    const selected = state({
      enhanced: {
        ...ENHANCED,
        accountOptions: [ENHANCED.accountOptions[0]!],
        selectedAccountKey: ENHANCED.accountOptions[0]!.key,
      },
    });
    expect(section(selected, "account")?.entries[1]).toMatchObject({ title: "Codex", state: "on" });
    const missing = state({
      enhanced: { ...ENHANCED, accountOptions: [], selectedAccountKey: '["gone","x"]' },
    });
    expect(section(missing, "account")?.entries.map((entry) => entry.title)).toEqual([
      "All accounts",
      "Unavailable account",
    ]);
  });

  it("selects an account, clears it, and ignores an account that is not offered", () => {
    const menu = state();
    const actions = handlers();
    applyHomeListFilterAction('account:["env-b","claude"]', menu, actions);
    expect(actions.onAccountChange).toHaveBeenLastCalledWith('["env-b","claude"]');
    applyHomeListFilterAction("account:all", menu, actions);
    expect(actions.onAccountChange).toHaveBeenLastCalledWith(null);
    applyHomeListFilterAction('account:["env-z","x"]', menu, actions);
    expect(actions.onAccountChange).toHaveBeenCalledTimes(2);
  });
});

describe("project menu", () => {
  it("is multi-select with the enhanced filter: toggles, keeps the menu open, All projects clears", () => {
    const menu = state({ selectedProjectKeys: ["alpha"] });
    const project = section(menu, "project");
    expect(project?.entries).toEqual([
      {
        id: "project:all",
        title: "All projects",
        subtitle: "Show threads from every project",
        state: "off",
      },
      { id: "project:alpha", title: "Alpha", state: "on", keepsMenuPresented: true },
      { id: "project:beta", title: "Beta", state: "off", keepsMenuPresented: true },
    ]);
    const actions = handlers();
    applyHomeListFilterAction("project:beta", menu, actions);
    expect(actions.onProjectsChange).toHaveBeenLastCalledWith(["alpha", "beta"]);
    applyHomeListFilterAction("project:alpha", menu, actions);
    expect(actions.onProjectsChange).toHaveBeenLastCalledWith([]);
    applyHomeListFilterAction("project:all", menu, actions);
    expect(actions.onProjectsChange).toHaveBeenLastCalledWith([]);
    applyHomeListFilterAction("project:nope", menu, actions);
    expect(actions.onProjectsChange).toHaveBeenCalledTimes(3);
  });

  it("replaces the choice and closes the menu without the enhanced filter", () => {
    const menu = state({ enhanced: null, selectedProjectKeys: ["alpha"] });
    expect(
      section(menu, "project")?.entries.some((entry) => entry.keepsMenuPresented === true),
    ).toBe(false);
    const actions = handlers();
    applyHomeListFilterAction("project:beta", menu, actions);
    expect(actions.onProjectsChange).toHaveBeenLastCalledWith(["beta"]);
  });

  it("labels the chip", () => {
    const { projects } = state();
    expect(projectFilterLabel(projects, [])).toBe("All projects");
    expect(projectFilterLabel(projects, ["beta"])).toBe("Beta");
    expect(projectFilterLabel(projects, ["alpha", "beta"])).toBe("2 projects");
    expect(projectFilterLabel(projects, ["gone"])).toBe("All projects");
  });

  it("is left out when there are no projects", () => {
    expect(section(state({ projects: [] }), "project")).toBeUndefined();
  });
});

describe("with the enhanced filter off", () => {
  const off = state({ enhanced: null });

  it("offers only the environment and project menus", () => {
    expect(buildHomeListFilterSections(off).map((entry) => entry.id)).toEqual([
      "environment",
      "project",
    ]);
  });

  it("ignores status and account actions", () => {
    const actions = handlers();
    applyHomeListFilterAction("status:input", off, actions);
    applyHomeListFilterAction("status:clear", off, actions);
    applyHomeListFilterAction("account:all", off, actions);
    expect(actions.onStatusesChange).not.toHaveBeenCalled();
    expect(actions.onAccountChange).not.toHaveBeenCalled();
  });
});

describe("subtitles on the All entries", () => {
  const allSubtitles = (menu: HomeListFilterMenuState) =>
    buildHomeListFilterSections(menu)
      .flatMap((entry) => entry.entries)
      .filter((entry) => entry.id === "environment:all" || entry.id === "project:all")
      .map((entry) => entry.subtitle);

  it("are on with the enhanced filter", () => {
    expect(allSubtitles(state())).toEqual([
      "Show threads from every environment",
      "Show threads from every project",
    ]);
  });

  it("are left out on a phone while it is off, as before", () => {
    expect(allSubtitles(state({ enhanced: null }))).toEqual([undefined, undefined]);
  });

  it("stay on the tablet sidebar while it is off, as before", () => {
    expect(allSubtitles(state({ enhanced: null, sidebar: true }))).toEqual([
      "Show threads from every environment",
      "Show threads from every project",
    ]);
  });
});

describe("reset entry", () => {
  const customized = state({ selectedEnvironmentId: ENV_A });
  const reset = (menu: HomeListFilterMenuState) =>
    homeListFilterSubmenuActions(
      buildHomeListFilterSections(menu),
      isHomeListFilterCustomized(menu),
    ).filter((action) => action.id === "reset");

  it("is in the Android menu only while a filter is set", () => {
    expect(reset(state())).toEqual([]);
    expect(reset(customized)).toEqual([{ id: "reset", title: "Reset filters" }]);
    expect(
      reset(state({ enhanced: { ...ENHANCED, statuses: ["failed"] } })).map((action) => action.id),
    ).toEqual(["reset"]);
    // The submenus are unchanged without the flag.
    expect(
      homeListFilterSubmenuActions(buildHomeListFilterSections(customized)).map(
        (action) => action.id,
      ),
    ).toEqual(["environment", "project", "status", "account"]);
  });

  it("is a top-level item of the sidebar menu only while a filter is set", () => {
    const titles = (menu: HomeListFilterMenuState) =>
      buildHomeListFilterMenu(menu, handlers()).items.map((item) => item.title);
    expect(titles(state())).not.toContain("Reset filters");
    expect(titles(customized).at(-1)).toBe("Reset filters");
    // Saved status and account do nothing while the enhanced filter is off.
    expect(titles(state({ enhanced: null }))).not.toContain("Reset filters");
  });

  it("runs the reset control from either menu", () => {
    const actions = handlers();
    applyHomeListFilterAction("reset", customized, actions);
    expect(actions.onReset).toHaveBeenCalledTimes(1);
    const item = buildHomeListFilterMenu(customized, actions).items.at(-1);
    if (item?.type !== "action") throw new Error("expected the reset action");
    item.onPress();
    expect(actions.onReset).toHaveBeenCalledTimes(2);
  });
});

describe("chip accessibility labels", () => {
  it("name the filter and its selection", () => {
    expect(homeListFilterChipAccessibilityLabels(state())).toEqual({
      environment: "Filter threads by environment, All environments",
      project: "Filter threads by project, All projects",
    });
    expect(
      homeListFilterChipAccessibilityLabels(
        state({
          selectedEnvironmentId: ENV_B,
          selectedProjectKeys: ["alpha", "beta"],
        }),
      ),
    ).toEqual({
      environment: "Filter threads by environment, Server",
      project: "Filter threads by project, 2 projects",
    });
  });
});

describe("environment menu", () => {
  it("selects and clears an environment", () => {
    const menu = state({ selectedEnvironmentId: ENV_B });
    expect(section(menu, "environment")?.entries.map((entry) => [entry.id, entry.state])).toEqual([
      ["environment:all", "off"],
      ["environment:env-a", "off"],
      ["environment:env-b", "on"],
    ]);
    const actions = handlers();
    applyHomeListFilterAction("environment:env-a", menu, actions);
    expect(actions.onEnvironmentChange).toHaveBeenLastCalledWith(ENV_A);
    applyHomeListFilterAction("environment:all", menu, actions);
    expect(actions.onEnvironmentChange).toHaveBeenLastCalledWith(null);
  });
});

describe("menu shapes", () => {
  it("converts entries to menu actions, with the keep-open attribute only where set", () => {
    const actions = homeListFilterMenuActions(section(state(), "status")!.entries);
    expect(actions[0]).toEqual({
      id: "status:input",
      title: "Input",
      subtitle: "1 thread",
      state: "off",
      attributes: { keepsMenuPresented: true },
    });
    const environment = homeListFilterMenuActions(section(state(), "environment")!.entries);
    expect(environment[0]).not.toHaveProperty("attributes");
  });

  it("nests the sections for the Android toolbar menu", () => {
    const nested = homeListFilterSubmenuActions(buildHomeListFilterSections(state()));
    expect(nested.map((action) => [action.id, action.title])).toEqual([
      ["environment", "Environment"],
      ["project", "Project"],
      ["status", "Status"],
      ["account", "Account"],
    ]);
    expect(nested[2]?.subactions?.map((action) => action.id)).toEqual([
      "status:input",
      "status:working",
      "status:failed",
      "status:done",
    ]);
  });

  it("builds the native header menu, whose items run the same actions", () => {
    const actions = handlers();
    const menu = buildHomeListFilterMenu(state(), actions);
    expect(menu.title).toBe("Thread list options");
    const status = menu.items.find((item) => item.title === "Status");
    if (status?.type !== "submenu") throw new Error("expected the status submenu");
    expect(status.items[1]).toMatchObject({
      title: "Working",
      subtitle: "3 threads",
      state: "off",
      keepsMenuPresented: true,
    });
    status.items[1]!.onPress();
    expect(actions.onStatusesChange).toHaveBeenCalledWith(["working"]);
  });

  it("tells when a filter narrows the list", () => {
    expect(isHomeListFilterCustomized(state())).toBe(false);
    expect(isHomeListFilterCustomized(state({ selectedEnvironmentId: ENV_A }))).toBe(true);
    expect(isHomeListFilterCustomized(state({ selectedProjectKeys: ["alpha"] }))).toBe(true);
    expect(
      isHomeListFilterCustomized(state({ enhanced: { ...ENHANCED, statuses: ["input"] } })),
    ).toBe(true);
    expect(
      isHomeListFilterCustomized(state({ enhanced: { ...ENHANCED, selectedAccountKey: "x" } })),
    ).toBe(true);
    // Saved status and account choices do nothing while the enhanced filter is off.
    expect(isHomeListFilterCustomized(state({ enhanced: null }))).toBe(false);
  });
});

describe("filter button", () => {
  it("counts each status, each project, the environment and the account", () => {
    expect(homeListFilterActiveCount(state())).toBe(0);
    expect(homeListFilterActiveCount(state({ selectedEnvironmentId: ENV_A }))).toBe(1);
    expect(
      homeListFilterActiveCount(
        state({
          selectedEnvironmentId: ENV_B,
          selectedProjectKeys: ["alpha", "beta"],
          enhanced: { ...ENHANCED, statuses: ["failed"], selectedAccountKey: "x" },
        }),
      ),
    ).toBe(5);
  });

  it("ignores status and account while the enhanced filter is off", () => {
    expect(
      homeListFilterActiveCount({
        selectedEnvironmentId: ENV_A,
        selectedProjectKeys: ["alpha"],
        enhanced: null,
      }),
    ).toBe(2);
  });

  it("names the count in the accessibility label only when a filter is set", () => {
    expect(homeListFilterButtonLabel(0)).toBe("Filters");
    expect(homeListFilterButtonLabel(1)).toBe("Filters, 1 active");
    expect(homeListFilterButtonLabel(3)).toBe("Filters, 3 active");
  });
});

describe("filter sheet", () => {
  it("shows a count and the selection on each of the four statuses", () => {
    const sheet = buildHomeListFilterSheet(
      state({ enhanced: { ...ENHANCED, statuses: ["working"] } }),
    );
    expect(sheet.status).toEqual([
      {
        id: "status:input",
        label: "Input",
        count: "1",
        countSubtitle: "1 thread",
        selected: false,
      },
      {
        id: "status:working",
        label: "Working",
        count: "3",
        countSubtitle: "3 threads",
        selected: true,
      },
      {
        id: "status:failed",
        label: "Failed",
        count: "0",
        countSubtitle: "0 threads",
        selected: false,
      },
      {
        id: "status:done",
        label: "Done",
        count: "40",
        countSubtitle: "40 threads",
        selected: false,
      },
    ]);
  });

  it("marks the Done count with a plus while older settled threads are not loaded", () => {
    const done = buildHomeListFilterSheet(
      state({ enhanced: { ...ENHANCED, doneHasMore: true } }),
    ).status?.find((status) => status.id === "status:done");
    expect(done).toMatchObject({ count: "40+", countSubtitle: "40+ threads" });
  });

  it("leaves the counts out until they are known", () => {
    const sheet = buildHomeListFilterSheet(
      state({ enhanced: { ...ENHANCED, statusCounts: null } }),
    );
    expect(sheet.status?.every((status) => status.count === null)).toBe(true);
  });

  it("offers no status section while the enhanced filter is off", () => {
    expect(buildHomeListFilterSheet(state({ enhanced: null })).status).toBeNull();
  });

  it("lists projects with All projects first and environments with All environments first", () => {
    const sheet = buildHomeListFilterSheet(
      state({ selectedProjectKeys: ["beta"], selectedEnvironmentId: ENV_B }),
    );
    expect(sheet.projects?.map((entry) => [entry.id, entry.state])).toEqual([
      ["project:all", "off"],
      ["project:alpha", "off"],
      ["project:beta", "on"],
    ]);
    expect(sheet.environment.map((entry) => [entry.id, entry.state])).toEqual([
      ["environment:all", "off"],
      [`environment:${ENV_A}`, "off"],
      [`environment:${ENV_B}`, "on"],
    ]);
  });

  it("hides Projects when there are none", () => {
    expect(buildHomeListFilterSheet(state({ projects: [] })).projects).toBeNull();
  });

  it("shows Account only with several accounts or one selected", () => {
    expect(buildHomeListFilterSheet(state()).account?.map((entry) => entry.id)).toEqual([
      "account:all",
      'account:["env-a","codex"]',
      'account:["env-b","claude"]',
    ]);
    const single = { ...ENHANCED, accountOptions: ENHANCED.accountOptions.slice(0, 1) };
    expect(buildHomeListFilterSheet(state({ enhanced: single })).account).toBeNull();
    expect(
      buildHomeListFilterSheet(
        state({ enhanced: { ...single, selectedAccountKey: single.accountOptions[0]!.key } }),
      ).account,
    ).not.toBeNull();
  });

  it("uses ids the menu action handler takes", () => {
    const actions = handlers();
    const menu = state();
    applyHomeListFilterAction("status:failed", menu, actions);
    applyHomeListFilterAction("project:all", menu, actions);
    expect(actions.onStatusesChange).toHaveBeenCalledWith(["failed"]);
    expect(actions.onProjectsChange).toHaveBeenCalledWith([]);
  });
});
