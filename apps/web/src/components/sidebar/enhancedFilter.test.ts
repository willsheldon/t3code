import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  compileThreadTitleRules,
  hasLiveThreadFilters,
  newThreadTitleRule,
  type ThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";
import { wantedOlderSettledPages } from "@t3tools/client-runtime/state/threads";
import { describe, expect, it } from "vite-plus/test";

import {
  filterSidebarProjectOptions,
  hasSidebarEnhancedFilterContent,
  sidebarEnhancedFilterBadgeCount,
  sidebarEnhancedFilterButtonLabel,
  sidebarSettledFilterCounts,
  sidebarSettledPageThreads,
} from "./enhancedFilter";

const rule = (overrides: Partial<ThreadTitleRule> & { id: string }): ThreadTitleRule => ({
  ...newThreadTitleRule(overrides.id),
  ...overrides,
});

describe("labels", () => {
  const accountOptions = [{ key: "acct", label: "Autimo Claude" }];

  it("names the trigger and counts live filters", () => {
    const rules = [
      rule({ id: "a", pattern: "bot-" }),
      rule({ id: "b", mode: "only", pattern: "^fix", regex: true }),
      rule({ id: "c", pattern: "off", enabled: false }),
    ];
    const compiled = compileThreadTitleRules(rules);
    expect(
      sidebarEnhancedFilterButtonLabel({
        rules,
        accountKey: "acct",
        accountOptions,
        projectNames: [],
      }),
    ).toBe('Enhanced filter: hide "bot-", only /^fix/, Autimo Claude');
    expect(
      sidebarEnhancedFilterButtonLabel({
        rules: [],
        accountKey: null,
        accountOptions,
        projectNames: [],
      }),
    ).toBe("Enhanced filter");
    expect(
      sidebarEnhancedFilterButtonLabel({
        rules: [],
        accountKey: "gone",
        accountOptions,
        projectNames: [],
      }),
    ).toBe("Enhanced filter: Unavailable account");
    expect(sidebarEnhancedFilterBadgeCount(compiled, "acct", 0)).toBe(3);
  });

  it("has content for any non-blank rule or an account", () => {
    expect(
      hasSidebarEnhancedFilterContent([rule({ id: "a", enabled: false, pattern: "x" })], null, 0),
    ).toBe(true);
    expect(hasSidebarEnhancedFilterContent([rule({ id: "a" })], null, 0)).toBe(false);
    expect(hasSidebarEnhancedFilterContent([], "acct", 0)).toBe(true);
  });
});

describe("sidebarSettledFilterCounts", () => {
  it("keeps upstream total counts when no filter is active", () => {
    expect(
      sidebarSettledFilterCounts({ matched: 4, visible: 2, unloaded: 10, filtering: false }),
    ).toEqual({ count: 14, hidden: 12, hasUnloaded: false });
  });

  it("counts known matches once and keeps unloaded history reachable", () => {
    expect(
      sidebarSettledFilterCounts({ matched: 4, visible: 2, unloaded: 10, filtering: true }),
    ).toEqual({ count: 4, hidden: 2, hasUnloaded: true });
    expect(
      sidebarSettledFilterCounts({ matched: 0, visible: 0, unloaded: 10, filtering: true }),
    ).toEqual({ count: 0, hidden: 0, hasUnloaded: true });
  });

  it("stops offering more when all history has been loaded", () => {
    expect(
      sidebarSettledFilterCounts({ matched: 0, visible: 0, unloaded: 0, filtering: true }),
    ).toEqual({ count: 0, hidden: 0, hasUnloaded: false });
  });
});

describe("sidebarSettledPageThreads", () => {
  it("stops automatic page growth after scanning a nonmatching page", () => {
    const environmentId = EnvironmentId.make("env");
    const requested = new Map([[environmentId, 1]]);
    const environments = new Map([
      [
        environmentId,
        {
          older: {
            before: "2026-10-20T00:00:00Z",
            beforeMs: 0,
            counts: new Map([[ProjectId.make("project"), 75]]),
          },
          pages: {
            reads: [],
            frontier: { settledAt: "2026-10-19T00:00:00Z", threadId: ThreadId.make("last") },
            status: "ready" as const,
          },
        },
      ],
    ]);
    const scanned = Array.from({ length: 25 }, (_, index) => ({ title: `bot ${index}` }));
    const { listedThreads, growthThreads } = sidebarSettledPageThreads(scanned, [], () => true);
    expect(listedThreads).toEqual([]);
    expect(
      wantedOlderSettledPages({
        requested,
        environments,
        listedCount: growthThreads.length,
        visibleCount: 25,
      }),
    ).toBe(requested);
    expect(
      wantedOlderSettledPages({
        requested,
        environments,
        listedCount: growthThreads.length,
        visibleCount: 50,
      }),
    ).toEqual(new Map([[environmentId, 2]]));
  });

  it("does not count cached rows below the global page frontier", () => {
    const scanned = [{ listed: true }, { listed: false }];
    expect(sidebarSettledPageThreads(scanned, scanned, (thread) => thread.listed)).toEqual({
      listedThreads: [scanned[0]],
      growthThreads: [scanned[0]],
    });
  });
});

describe("enhanced filter projects", () => {
  const options = [
    { key: "env:a", label: "Alpha" },
    { key: "env:b", label: "Beta Tools" },
  ];

  it("counts every selected project in the badge and content check", () => {
    const compiled = compileThreadTitleRules([]);
    expect(sidebarEnhancedFilterBadgeCount(compiled, null, 2)).toBe(2);
    expect(sidebarEnhancedFilterBadgeCount(compiled, "acct", 2)).toBe(3);
    expect(hasSidebarEnhancedFilterContent([], null, 1)).toBe(true);
    expect(hasSidebarEnhancedFilterContent([], null, 0)).toBe(false);
  });

  it("names selected projects in the button label", () => {
    expect(
      sidebarEnhancedFilterButtonLabel({
        rules: [],
        accountKey: null,
        accountOptions: [],
        projectNames: ["Alpha", "Beta Tools"],
      }),
    ).toBe("Enhanced filter: Alpha, Beta Tools");
  });

  it("matches project names ignoring case and outer spaces", () => {
    expect(filterSidebarProjectOptions(options, "  beta ")).toEqual([options[1]]);
    expect(filterSidebarProjectOptions(options, "")).toEqual(options);
    expect(filterSidebarProjectOptions(options, "missing")).toEqual([]);
  });
});

describe("status filter on the trigger", () => {
  const compiled = compileThreadTitleRules([]);

  it("counts a selected status as an active filter", () => {
    expect(hasLiveThreadFilters({ compiled, accountKey: null, statuses: [] })).toBe(false);
    expect(hasLiveThreadFilters({ compiled, accountKey: null, statuses: ["done"] })).toBe(true);
    expect(sidebarEnhancedFilterBadgeCount(compiled, null, 0, 2)).toBe(2);
    expect(hasSidebarEnhancedFilterContent([], null, 0, 1)).toBe(true);
    expect(
      sidebarEnhancedFilterButtonLabel({
        rules: [],
        accountKey: null,
        accountOptions: [],
        projectNames: [],
        statuses: ["input"],
      }),
    ).toBe("Enhanced filter: Input");
  });
});
