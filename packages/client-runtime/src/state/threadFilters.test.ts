import { RunId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { isLatestRunSettled } from "./models.ts";
import {
  EMPTY_THREAD_FILTER,
  LEGACY_THREAD_TITLE_FILTER_KEY,
  THREAD_FILTER_GUARD_MESSAGE,
  THREAD_FILTER_KEY,
  THREAD_FILTER_PASS_KEY,
  THREAD_TITLE_RULE_LIMIT,
  type ThreadFilterStore,
  type ThreadTitleRule,
  compileThreadTitleRules,
  countThreadFilterStatuses,
  initializeThreadFilter,
  insertThreadTitleRule,
  matchesThreadFilters,
  matchesThreadTitleRules,
  migrateLegacyThreadTitleFilter,
  newThreadTitleRule,
  removeThreadTitleRule,
  resolveThreadFilterStatus,
  setThreadTitleRuleEnabled,
  setThreadTitleRulePattern,
  threadTitleRuleFocusAfterRemoval,
  threadTitleRuleText,
  threadTitleRulesFingerprint,
  toggleThreadFilterStatus,
  warmThreadTitleRuleCache,
} from "./threadFilters.ts";

const rule = (overrides: Partial<ThreadTitleRule> & { id: string }): ThreadTitleRule => ({
  ...newThreadTitleRule(overrides.id),
  ...overrides,
});

class MemoryStore implements ThreadFilterStore {
  readonly items = new Map<string, string>();
  writes = 0;
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes += 1;
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

const throwingStore: ThreadFilterStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const passes = (rules: ReadonlyArray<ThreadTitleRule>, title: string) =>
  matchesThreadTitleRules(compileThreadTitleRules(rules), title);

describe("title rule matching", () => {
  it("hides plain matches case-insensitively", () => {
    const rules = [rule({ id: "a", pattern: "Bot-" })];
    expect(passes(rules, "bot-claude-code--Rebuild")).toBe(false);
    expect(passes(rules, "Fix sidebar")).toBe(true);
  });

  it("shows only matches of any only rule", () => {
    const rules = [
      rule({ id: "a", mode: "only", pattern: "fix" }),
      rule({ id: "b", mode: "only", pattern: "feat" }),
    ];
    expect(passes(rules, "fix: drag")).toBe(true);
    expect(passes(rules, "feat: filter")).toBe(true);
    expect(passes(rules, "chore: bump")).toBe(false);
  });

  it("applies hide rules on top of only rules", () => {
    const rules = [
      rule({ id: "a", mode: "only", pattern: "fix" }),
      rule({ id: "b", mode: "hide", pattern: "bot" }),
    ];
    expect(passes(rules, "fix: drag")).toBe(true);
    expect(passes(rules, "bot fix")).toBe(false);
  });

  it("matches non-ASCII titles case-insensitively", () => {
    expect(passes([rule({ id: "a", pattern: "ÉTÉ" })], "Plan d'été")).toBe(false);
    expect(passes([rule({ id: "a", pattern: "🚀 deploy" })], "🚀 Deploy prod")).toBe(false);
    expect(passes([rule({ id: "a", pattern: "été", regex: true })], "ÉTÉ plan")).toBe(false);
  });

  it("matches regex rules and treats slashes and flags as literal text", () => {
    expect(passes([rule({ id: "a", pattern: "^(fix|feat)\\b", regex: true })], "Fix: x")).toBe(
      false,
    );
    expect(passes([rule({ id: "a", pattern: "/foo/g", regex: true })], "foo")).toBe(true);
    expect(passes([rule({ id: "a", pattern: "/foo/g", regex: true })], "a /FOO/G b")).toBe(false);
  });

  it("skips invalid regex rules and reports the error", () => {
    const compiled = compileThreadTitleRules([rule({ id: "a", pattern: "(", regex: true })]);
    expect(compiled.liveCount).toBe(0);
    expect(compiled.errors.get("a")).toMatch(/./);
    expect(matchesThreadTitleRules(compiled, "anything")).toBe(true);
  });

  it("ignores blank, disabled and tripped rules", () => {
    const rules = [
      rule({ id: "a", pattern: "   " }),
      rule({ id: "b", pattern: "x", enabled: false }),
      rule({ id: "c", pattern: "x", regex: true, enabled: false, tripped: true }),
    ];
    const compiled = compileThreadTitleRules(rules);
    expect(compiled.liveCount).toBe(0);
    expect(compiled.liveKey).toBe("");
    expect(compiled.errors.get("c")).toBe(THREAD_FILTER_GUARD_MESSAGE);
  });

  it("counts a throwing regex as no match and records the error", () => {
    const compiled = compileThreadTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    const test = vi.spyOn(RegExp.prototype, "test").mockImplementation(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    try {
      expect(matchesThreadTitleRules(compiled, "x")).toBe(true);
    } finally {
      test.mockRestore();
    }
    expect(compiled.errors.get("a")).toBe("Maximum call stack size exceeded");
  });
});

describe("thread filters", () => {
  const thread = {
    title: "bot-claude-code--Rebuild",
    environmentId: "env",
    providerInstanceId: "codex",
  };
  const compiled = compileThreadTitleRules([rule({ id: "a", pattern: "bot-" })]);

  it("filters by account alone and with rules", () => {
    const none = compileThreadTitleRules([]);
    const accountKey = JSON.stringify(["env", "codex"]);
    expect(matchesThreadFilters(thread, { compiled: none, accountKey, isOpen: false })).toBe(true);
    expect(
      matchesThreadFilters(thread, { compiled: none, accountKey: "other", isOpen: false }),
    ).toBe(false);
    expect(matchesThreadFilters(thread, { compiled, accountKey, isOpen: false })).toBe(false);
  });

  it("always keeps the open thread", () => {
    expect(matchesThreadFilters(thread, { compiled, accountKey: "other", isOpen: true })).toBe(
      true,
    );
  });
});

describe("title cache and runaway guard", () => {
  it("reuses the compiled rules and title cache while the rules are unchanged", () => {
    const rules = [rule({ id: "a", pattern: "reuse", regex: true })];
    const compiled = compileThreadTitleRules(rules);
    expect(compileThreadTitleRules(rules.map((r) => ({ ...r })))).toBe(compiled);
    expect(compileThreadTitleRules([rule({ id: "a", pattern: "other", regex: true })])).not.toBe(
      compiled,
    );
  });

  it("writes and removes the pass marker around uncached regex matching only", () => {
    const store = new MemoryStore();
    const compiled = compileThreadTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    warmThreadTitleRuleCache(compiled, ["a", "b"], store, 10_000);
    expect(store.writes).toBe(1);
    expect(store.getItem(THREAD_FILTER_PASS_KEY)).toBeNull();
    warmThreadTitleRuleCache(compiled, ["a", "b"], store, 20_000);
    expect(store.writes).toBe(1);
  });

  it("runs each regex once per title across passes", () => {
    const compiled = compileThreadTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    const test = vi.spyOn(RegExp.prototype, "test");
    try {
      for (let pass = 0; pass < 5; pass += 1) {
        warmThreadTitleRuleCache(compiled, ["one", "two"], null);
        matchesThreadTitleRules(compiled, "one");
        matchesThreadTitleRules(compiled, "two");
      }
      expect(test).toHaveBeenCalledTimes(2);
    } finally {
      test.mockRestore();
    }
  });

  it("writes nothing for plain-only rules", () => {
    const store = new MemoryStore();
    warmThreadTitleRuleCache(
      compileThreadTitleRules([rule({ id: "a", pattern: "x" })]),
      ["a"],
      store,
    );
    expect(store.writes).toBe(0);
  });

  it("removes the marker even when matching throws", () => {
    const store = new MemoryStore();
    const compiled = compileThreadTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    const titles = {
      *[Symbol.iterator]() {
        yield "a";
        throw new Error("boom");
      },
    };
    expect(() => warmThreadTitleRuleCache(compiled, titles, store)).toThrow("boom");
    expect(store.getItem(THREAD_FILTER_PASS_KEY)).toBeNull();
  });

  it("survives a store that throws", () => {
    const compiled = compileThreadTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    expect(() => warmThreadTitleRuleCache(compiled, ["x"], throwingStore)).not.toThrow();
    expect(matchesThreadTitleRules(compiled, "x")).toBe(false);
    expect(initializeThreadFilter(throwingStore, () => "id")).toEqual(EMPTY_THREAD_FILTER);
  });

  it("fingerprints live regex rules only", () => {
    const a = [rule({ id: "a", pattern: "x", regex: true }), rule({ id: "b", pattern: "plain" })];
    expect(threadTitleRulesFingerprint(a)).toBe(threadTitleRulesFingerprint([...a]));
    expect(threadTitleRulesFingerprint(a)).not.toBe(
      threadTitleRulesFingerprint([rule({ id: "a", pattern: "y", regex: true })]),
    );
    expect(threadTitleRulesFingerprint([rule({ id: "b", pattern: "plain" })])).toBe("");
    expect(threadTitleRulesFingerprint([rule({ id: "c", pattern: "(", regex: true })])).toBe("");
  });
});

describe("startup", () => {
  const regexRule = rule({ id: "r", pattern: "^(\\w+\\s?)*$", regex: true });
  const plainRule = rule({ id: "p", pattern: "bot" });
  const seed = (store: MemoryStore, rules: ReadonlyArray<ThreadTitleRule>, markerAt: number) => {
    store.items.set(THREAD_FILTER_KEY, JSON.stringify({ rules }));
    store.items.set(
      THREAD_FILTER_PASS_KEY,
      JSON.stringify({ fingerprint: threadTitleRulesFingerprint(rules), at: markerAt }),
    );
  };

  it("trips the fingerprinted regex rules when an old marker matches", () => {
    const store = new MemoryStore();
    seed(store, [regexRule, plainRule], 0);
    const result = initializeThreadFilter(store, () => "id", 5_000);
    expect(result.rules).toEqual([{ ...regexRule, enabled: false, tripped: true }, plainRule]);
    expect(JSON.parse(store.getItem(THREAD_FILTER_KEY)!)).toEqual(result);
    expect(store.getItem(THREAD_FILTER_PASS_KEY)).toBeNull();
  });

  it("ignores a marker younger than two seconds", () => {
    const store = new MemoryStore();
    seed(store, [regexRule], 4_000);
    const result = initializeThreadFilter(store, () => "id", 5_000);
    expect(result.rules).toEqual([regexRule]);
    expect(store.getItem(THREAD_FILTER_PASS_KEY)).not.toBeNull();
  });

  it("removes a marker that does not match the stored rules", () => {
    const store = new MemoryStore();
    seed(store, [regexRule], 0);
    store.items.set(THREAD_FILTER_KEY, JSON.stringify({ rules: [plainRule] }));
    const result = initializeThreadFilter(store, () => "id", 5_000);
    expect(result.rules).toEqual([plainRule]);
    expect(store.getItem(THREAD_FILTER_PASS_KEY)).toBeNull();
  });

  it("drops corrupt rules data so later writes succeed", () => {
    const store = new MemoryStore();
    store.items.set(THREAD_FILTER_KEY, "{not json");
    expect(initializeThreadFilter(store, () => "id")).toEqual(EMPTY_THREAD_FILTER);
    expect(store.getItem(THREAD_FILTER_KEY)).toBeNull();
  });

  it("fills missing rule fields with defaults", () => {
    const store = new MemoryStore();
    store.items.set(THREAD_FILTER_KEY, JSON.stringify({ rules: [{ id: "x", pattern: "a" }] }));
    expect(initializeThreadFilter(store, () => "id").rules).toEqual([
      { id: "x", mode: "hide", pattern: "a", regex: false, enabled: true, tripped: false },
    ]);
  });

  it("migrates the legacy filter once and keeps the legacy key", () => {
    const store = new MemoryStore();
    store.items.set(
      LEGACY_THREAD_TITLE_FILTER_KEY,
      JSON.stringify({ text: " bot- ", mode: "exclude" }),
    );
    const result = initializeThreadFilter(store, () => "new-id");
    expect(result.rules).toEqual([rule({ id: "new-id", pattern: "bot-" })]);
    expect(store.getItem(LEGACY_THREAD_TITLE_FILTER_KEY)).not.toBeNull();
    expect(JSON.parse(store.getItem(THREAD_FILTER_KEY)!)).toEqual(result);
  });

  it("maps legacy include to only and ignores blank legacy text", () => {
    expect(
      migrateLegacyThreadTitleFilter(JSON.stringify({ text: "fix", mode: "include" }), () => "i")
        .rules[0]?.mode,
    ).toBe("only");
    expect(
      migrateLegacyThreadTitleFilter(JSON.stringify({ text: "  ", mode: "include" }), () => "i"),
    ).toEqual(EMPTY_THREAD_FILTER);
    expect(migrateLegacyThreadTitleFilter(null, () => "i")).toEqual(EMPTY_THREAD_FILTER);
  });
});

describe("rule list editing", () => {
  const rules = [rule({ id: "a" }), rule({ id: "b" }), rule({ id: "c" })];

  it("inserts after a rule, appends, and stops at the limit", () => {
    expect(insertThreadTitleRule(rules, "a", rule({ id: "n" })).map((r) => r.id)).toEqual([
      "a",
      "n",
      "b",
      "c",
    ]);
    expect(insertThreadTitleRule(rules, null, rule({ id: "n" })).at(-1)?.id).toBe("n");
    const full = Array.from({ length: THREAD_TITLE_RULE_LIMIT }, (_, i) => rule({ id: `${i}` }));
    expect(insertThreadTitleRule(full, null, rule({ id: "n" }))).toBe(full);
  });

  it("returns the same array for edits to a removed rule", () => {
    expect(setThreadTitleRulePattern(rules, "gone", "x")).toBe(rules);
    expect(removeThreadTitleRule(rules, "gone")).toBe(rules);
  });

  it("clears tripped when the pattern is edited or the rule is switched on", () => {
    const tripped = [rule({ id: "a", regex: true, pattern: "x", enabled: false, tripped: true })];
    expect(setThreadTitleRulePattern(tripped, "a", "y")[0]?.tripped).toBe(false);
    expect(setThreadTitleRuleEnabled(tripped, "a", true)[0]).toMatchObject({
      enabled: true,
      tripped: false,
    });
  });

  it("moves focus to the previous rule, else the next, else nowhere", () => {
    expect(threadTitleRuleFocusAfterRemoval(rules, "b")).toBe("a");
    expect(threadTitleRuleFocusAfterRemoval(rules, "a")).toBe("b");
    expect(threadTitleRuleFocusAfterRemoval([rule({ id: "a" })], "a")).toBeNull();
  });
});

describe("sidebar status filter", () => {
  type StatusThread = Parameters<typeof resolveThreadFilterStatus>[0];
  const run = (status: string, completedAt: string | null = "2026-01-02T00:00:00.000Z") =>
    ({ runId: "run-1", status, startedAt: "2026-01-01T00:00:00.000Z", completedAt }) as never;
  const thread = (overrides: Partial<StatusThread>): StatusThread =>
    ({
      hasActionableProposedPlan: false,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      pendingSubagentRequest: null,
      pendingGuestMessageCount: 0,
      interactionMode: "default",
      latestRun: null,
      runtime: null,
      lastVisitedAt: "2026-01-03T00:00:00.000Z",
      ...overrides,
    }) as StatusThread;

  it("puts everything waiting on the user under input", () => {
    expect(resolveThreadFilterStatus(thread({ hasPendingApprovals: true }))).toBe("input");
    expect(resolveThreadFilterStatus(thread({ hasPendingUserInput: true }))).toBe("input");
    expect(resolveThreadFilterStatus(thread({ pendingGuestMessageCount: 1 }))).toBe("input");
    expect(
      resolveThreadFilterStatus(
        thread({
          interactionMode: "plan",
          hasActionableProposedPlan: true,
          latestRun: run("completed"),
        }),
      ),
    ).toBe("input");
  });

  it("puts active runs under working, ahead of the finished run they replace", () => {
    for (const status of ["running", "waiting", "preparing", "starting", "queued"]) {
      expect(
        resolveThreadFilterStatus(
          thread({ latestRun: run("completed"), runtime: { status, activeRunId: null } as never }),
        ),
      ).toBe("working");
    }
  });

  it("puts a run blocked on another thread under working", () => {
    expect(
      resolveThreadFilterStatus(
        thread({
          blockedOnThreadWait: true,
          runtime: { status: "running", activeRunId: "run-1" } as never,
        }),
      ),
    ).toBe("working");
  });

  it("keeps done after the thread is read, and also while it is unread", () => {
    expect(resolveThreadFilterStatus(thread({ latestRun: run("completed") }))).toBe("done");
    expect(
      resolveThreadFilterStatus(
        thread({ latestRun: run("completed"), lastVisitedAt: "2026-01-01T12:00:00.000Z" }),
      ),
    ).toBe("done");
  });

  it("lists a failed run as failed until it is read, and never as done", () => {
    expect(
      resolveThreadFilterStatus(
        thread({ latestRun: run("failed"), lastVisitedAt: "2026-01-01T12:00:00.000Z" }),
      ),
    ).toBe("failed");
    expect(resolveThreadFilterStatus(thread({ latestRun: run("failed") }))).toBeNull();
  });

  it("gives a thread with no run no status", () => {
    expect(resolveThreadFilterStatus(thread({}))).toBeNull();
  });

  it("toggles without depending on click order", () => {
    expect(toggleThreadFilterStatus(["done"], "input")).toEqual(["input", "done"]);
    expect(toggleThreadFilterStatus(["input", "done"], "done")).toEqual(["input"]);
  });

  it("counts every thread once and skips those with no status", () => {
    const statuses = ["input", "done", "done", null] as const;
    expect(countThreadFilterStatuses(statuses, (status) => status)).toEqual({
      input: 1,
      working: 0,
      failed: 0,
      done: 2,
    });
  });

  const compiled = compileThreadTitleRules([]);
  const shell = { title: "A", environmentId: "env", providerInstanceId: "codex" };

  it("matches any selected status, and only when one is selected", () => {
    const filters = { compiled, accountKey: null, isOpen: false };
    const of = () => "done" as const;
    expect(matchesThreadFilters(shell, filters)).toBe(true);
    expect(matchesThreadFilters(shell, { ...filters, status: { selected: [], of } })).toBe(true);
    expect(
      matchesThreadFilters(shell, {
        ...filters,
        status: { selected: ["input", "done"], of },
      }),
    ).toBe(true);
    expect(matchesThreadFilters(shell, { ...filters, status: { selected: ["input"], of } })).toBe(
      false,
    );
    expect(
      matchesThreadFilters(shell, {
        ...filters,
        status: { selected: ["done"], of: () => null },
      }),
    ).toBe(false);
  });

  it("keeps the open thread visible when its status is not selected", () => {
    expect(
      matchesThreadFilters(shell, {
        compiled,
        accountKey: null,
        isOpen: true,
        status: { selected: ["input"], of: () => "done" },
      }),
    ).toBe(true);
  });
});

describe("rule text", () => {
  it("describes rules for chips", () => {
    expect(threadTitleRuleText(rule({ id: "a", pattern: " bot- " }))).toBe("Hide bot-");
    expect(threadTitleRuleText(rule({ id: "a", mode: "only", pattern: "^fix", regex: true }))).toBe(
      "Only /^fix/",
    );
  });
});

describe("run settlement", () => {
  it("uses run status as the settlement boundary", () => {
    const runId = RunId.make("run-1");
    expect(
      isLatestRunSettled(
        {
          runId,
          status: "completed",
          startedAt: "2026-06-20T00:00:00.000Z",
          completedAt: "2026-06-20T00:01:00.000Z",
        },
        null,
      ),
    ).toBe(true);
    expect(
      isLatestRunSettled(
        { runId, status: "running", startedAt: null, completedAt: null },
        { status: "running", activeRunId: runId },
      ),
    ).toBe(false);
    expect(
      isLatestRunSettled(
        { runId, status: "queued", startedAt: null, completedAt: null },
        { status: "running", activeRunId: RunId.make("run-active") },
      ),
    ).toBe(false);
  });
});
