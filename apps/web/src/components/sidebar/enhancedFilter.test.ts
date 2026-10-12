import { describe, expect, it, vi } from "vite-plus/test";

import {
  EMPTY_SIDEBAR_ENHANCED_FILTER,
  LEGACY_SIDEBAR_TITLE_FILTER_KEY,
  SIDEBAR_ENHANCED_FILTER_KEY,
  SIDEBAR_ENHANCED_FILTER_PASS_KEY,
  SIDEBAR_FILTER_GUARD_MESSAGE,
  SIDEBAR_TITLE_RULE_LIMIT,
  type SidebarFilterStore,
  type SidebarTitleRule,
  compileSidebarTitleRules,
  hasSidebarEnhancedFilterContent,
  initializeSidebarEnhancedFilter,
  insertSidebarTitleRule,
  matchesSidebarThreadFilters,
  matchesSidebarTitleRules,
  migrateLegacySidebarTitleFilter,
  newSidebarTitleRule,
  removeSidebarTitleRule,
  setSidebarTitleRuleEnabled,
  setSidebarTitleRulePattern,
  sidebarEnhancedFilterBadgeCount,
  sidebarEnhancedFilterButtonLabel,
  sidebarTitleRuleFocusAfterRemoval,
  sidebarTitleRuleText,
  sidebarTitleRulesFingerprint,
  warmSidebarTitleRuleCache,
} from "./enhancedFilter";

const rule = (overrides: Partial<SidebarTitleRule> & { id: string }): SidebarTitleRule => ({
  ...newSidebarTitleRule(overrides.id),
  ...overrides,
});

class MemoryStore implements SidebarFilterStore {
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

const throwingStore: SidebarFilterStore = {
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

const passes = (rules: ReadonlyArray<SidebarTitleRule>, title: string) =>
  matchesSidebarTitleRules(compileSidebarTitleRules(rules), title);

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
    const compiled = compileSidebarTitleRules([rule({ id: "a", pattern: "(", regex: true })]);
    expect(compiled.liveCount).toBe(0);
    expect(compiled.errors.get("a")).toMatch(/./);
    expect(matchesSidebarTitleRules(compiled, "anything")).toBe(true);
  });

  it("ignores blank, disabled and tripped rules", () => {
    const rules = [
      rule({ id: "a", pattern: "   " }),
      rule({ id: "b", pattern: "x", enabled: false }),
      rule({ id: "c", pattern: "x", regex: true, enabled: false, tripped: true }),
    ];
    const compiled = compileSidebarTitleRules(rules);
    expect(compiled.liveCount).toBe(0);
    expect(compiled.liveKey).toBe("");
    expect(compiled.errors.get("c")).toBe(SIDEBAR_FILTER_GUARD_MESSAGE);
  });

  it("counts a throwing regex as no match and records the error", () => {
    const compiled = compileSidebarTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    const test = vi.spyOn(RegExp.prototype, "test").mockImplementation(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    try {
      expect(matchesSidebarTitleRules(compiled, "x")).toBe(true);
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
  const compiled = compileSidebarTitleRules([rule({ id: "a", pattern: "bot-" })]);

  it("filters by account alone and with rules", () => {
    const none = compileSidebarTitleRules([]);
    const accountKey = JSON.stringify(["env", "codex"]);
    expect(matchesSidebarThreadFilters(thread, { compiled: none, accountKey, isOpen: false })).toBe(
      true,
    );
    expect(
      matchesSidebarThreadFilters(thread, { compiled: none, accountKey: "other", isOpen: false }),
    ).toBe(false);
    expect(matchesSidebarThreadFilters(thread, { compiled, accountKey, isOpen: false })).toBe(
      false,
    );
  });

  it("always keeps the open thread", () => {
    expect(
      matchesSidebarThreadFilters(thread, { compiled, accountKey: "other", isOpen: true }),
    ).toBe(true);
  });
});

describe("title cache and runaway guard", () => {
  it("writes and removes the pass marker around uncached regex matching only", () => {
    const store = new MemoryStore();
    const compiled = compileSidebarTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    warmSidebarTitleRuleCache(compiled, ["a", "b"], store, 10_000);
    expect(store.writes).toBe(1);
    expect(store.getItem(SIDEBAR_ENHANCED_FILTER_PASS_KEY)).toBeNull();
    warmSidebarTitleRuleCache(compiled, ["a", "b"], store, 20_000);
    expect(store.writes).toBe(1);
  });

  it("runs each regex once per title across passes", () => {
    const compiled = compileSidebarTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    const test = vi.spyOn(RegExp.prototype, "test");
    try {
      for (let pass = 0; pass < 5; pass += 1) {
        warmSidebarTitleRuleCache(compiled, ["one", "two"], null);
        matchesSidebarTitleRules(compiled, "one");
        matchesSidebarTitleRules(compiled, "two");
      }
      expect(test).toHaveBeenCalledTimes(2);
    } finally {
      test.mockRestore();
    }
  });

  it("writes nothing for plain-only rules", () => {
    const store = new MemoryStore();
    warmSidebarTitleRuleCache(
      compileSidebarTitleRules([rule({ id: "a", pattern: "x" })]),
      ["a"],
      store,
    );
    expect(store.writes).toBe(0);
  });

  it("removes the marker even when matching throws", () => {
    const store = new MemoryStore();
    const compiled = compileSidebarTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    const titles = {
      *[Symbol.iterator]() {
        yield "a";
        throw new Error("boom");
      },
    };
    expect(() => warmSidebarTitleRuleCache(compiled, titles, store)).toThrow("boom");
    expect(store.getItem(SIDEBAR_ENHANCED_FILTER_PASS_KEY)).toBeNull();
  });

  it("survives a store that throws", () => {
    const compiled = compileSidebarTitleRules([rule({ id: "a", pattern: "x", regex: true })]);
    expect(() => warmSidebarTitleRuleCache(compiled, ["x"], throwingStore)).not.toThrow();
    expect(matchesSidebarTitleRules(compiled, "x")).toBe(false);
    expect(initializeSidebarEnhancedFilter(throwingStore, () => "id")).toEqual(
      EMPTY_SIDEBAR_ENHANCED_FILTER,
    );
  });

  it("fingerprints live regex rules only", () => {
    const a = [rule({ id: "a", pattern: "x", regex: true }), rule({ id: "b", pattern: "plain" })];
    expect(sidebarTitleRulesFingerprint(a)).toBe(sidebarTitleRulesFingerprint([...a]));
    expect(sidebarTitleRulesFingerprint(a)).not.toBe(
      sidebarTitleRulesFingerprint([rule({ id: "a", pattern: "y", regex: true })]),
    );
    expect(sidebarTitleRulesFingerprint([rule({ id: "b", pattern: "plain" })])).toBe("");
    expect(sidebarTitleRulesFingerprint([rule({ id: "c", pattern: "(", regex: true })])).toBe("");
  });
});

describe("startup", () => {
  const regexRule = rule({ id: "r", pattern: "^(\\w+\\s?)*$", regex: true });
  const plainRule = rule({ id: "p", pattern: "bot" });
  const seed = (store: MemoryStore, rules: ReadonlyArray<SidebarTitleRule>, markerAt: number) => {
    store.items.set(SIDEBAR_ENHANCED_FILTER_KEY, JSON.stringify({ rules }));
    store.items.set(
      SIDEBAR_ENHANCED_FILTER_PASS_KEY,
      JSON.stringify({ fingerprint: sidebarTitleRulesFingerprint(rules), at: markerAt }),
    );
  };

  it("trips the fingerprinted regex rules when an old marker matches", () => {
    const store = new MemoryStore();
    seed(store, [regexRule, plainRule], 0);
    const result = initializeSidebarEnhancedFilter(store, () => "id", 5_000);
    expect(result.rules).toEqual([{ ...regexRule, enabled: false, tripped: true }, plainRule]);
    expect(JSON.parse(store.getItem(SIDEBAR_ENHANCED_FILTER_KEY)!)).toEqual(result);
    expect(store.getItem(SIDEBAR_ENHANCED_FILTER_PASS_KEY)).toBeNull();
  });

  it("ignores a marker younger than two seconds", () => {
    const store = new MemoryStore();
    seed(store, [regexRule], 4_000);
    const result = initializeSidebarEnhancedFilter(store, () => "id", 5_000);
    expect(result.rules).toEqual([regexRule]);
    expect(store.getItem(SIDEBAR_ENHANCED_FILTER_PASS_KEY)).not.toBeNull();
  });

  it("removes a marker that does not match the stored rules", () => {
    const store = new MemoryStore();
    seed(store, [regexRule], 0);
    store.items.set(SIDEBAR_ENHANCED_FILTER_KEY, JSON.stringify({ rules: [plainRule] }));
    const result = initializeSidebarEnhancedFilter(store, () => "id", 5_000);
    expect(result.rules).toEqual([plainRule]);
    expect(store.getItem(SIDEBAR_ENHANCED_FILTER_PASS_KEY)).toBeNull();
  });

  it("drops corrupt rules data so later writes succeed", () => {
    const store = new MemoryStore();
    store.items.set(SIDEBAR_ENHANCED_FILTER_KEY, "{not json");
    expect(initializeSidebarEnhancedFilter(store, () => "id")).toEqual(
      EMPTY_SIDEBAR_ENHANCED_FILTER,
    );
    expect(store.getItem(SIDEBAR_ENHANCED_FILTER_KEY)).toBeNull();
  });

  it("fills missing rule fields with defaults", () => {
    const store = new MemoryStore();
    store.items.set(
      SIDEBAR_ENHANCED_FILTER_KEY,
      JSON.stringify({ rules: [{ id: "x", pattern: "a" }] }),
    );
    expect(initializeSidebarEnhancedFilter(store, () => "id").rules).toEqual([
      { id: "x", mode: "hide", pattern: "a", regex: false, enabled: true, tripped: false },
    ]);
  });

  it("migrates the legacy filter once and keeps the legacy key", () => {
    const store = new MemoryStore();
    store.items.set(
      LEGACY_SIDEBAR_TITLE_FILTER_KEY,
      JSON.stringify({ text: " bot- ", mode: "exclude" }),
    );
    const result = initializeSidebarEnhancedFilter(store, () => "new-id");
    expect(result.rules).toEqual([rule({ id: "new-id", pattern: "bot-" })]);
    expect(store.getItem(LEGACY_SIDEBAR_TITLE_FILTER_KEY)).not.toBeNull();
    expect(JSON.parse(store.getItem(SIDEBAR_ENHANCED_FILTER_KEY)!)).toEqual(result);
  });

  it("maps legacy include to only and ignores blank legacy text", () => {
    expect(
      migrateLegacySidebarTitleFilter(JSON.stringify({ text: "fix", mode: "include" }), () => "i")
        .rules[0]?.mode,
    ).toBe("only");
    expect(
      migrateLegacySidebarTitleFilter(JSON.stringify({ text: "  ", mode: "include" }), () => "i"),
    ).toEqual(EMPTY_SIDEBAR_ENHANCED_FILTER);
    expect(migrateLegacySidebarTitleFilter(null, () => "i")).toEqual(EMPTY_SIDEBAR_ENHANCED_FILTER);
  });
});

describe("rule list editing", () => {
  const rules = [rule({ id: "a" }), rule({ id: "b" }), rule({ id: "c" })];

  it("inserts after a rule, appends, and stops at the limit", () => {
    expect(insertSidebarTitleRule(rules, "a", rule({ id: "n" })).map((r) => r.id)).toEqual([
      "a",
      "n",
      "b",
      "c",
    ]);
    expect(insertSidebarTitleRule(rules, null, rule({ id: "n" })).at(-1)?.id).toBe("n");
    const full = Array.from({ length: SIDEBAR_TITLE_RULE_LIMIT }, (_, i) => rule({ id: `${i}` }));
    expect(insertSidebarTitleRule(full, null, rule({ id: "n" }))).toBe(full);
  });

  it("returns the same array for edits to a removed rule", () => {
    expect(setSidebarTitleRulePattern(rules, "gone", "x")).toBe(rules);
    expect(removeSidebarTitleRule(rules, "gone")).toBe(rules);
  });

  it("clears tripped when the pattern is edited or the rule is switched on", () => {
    const tripped = [rule({ id: "a", regex: true, pattern: "x", enabled: false, tripped: true })];
    expect(setSidebarTitleRulePattern(tripped, "a", "y")[0]?.tripped).toBe(false);
    expect(setSidebarTitleRuleEnabled(tripped, "a", true)[0]).toMatchObject({
      enabled: true,
      tripped: false,
    });
  });

  it("moves focus to the previous rule, else the next, else nowhere", () => {
    expect(sidebarTitleRuleFocusAfterRemoval(rules, "b")).toBe("a");
    expect(sidebarTitleRuleFocusAfterRemoval(rules, "a")).toBe("b");
    expect(sidebarTitleRuleFocusAfterRemoval([rule({ id: "a" })], "a")).toBeNull();
  });
});

describe("labels", () => {
  const accountOptions = [{ key: "acct", label: "Autimo Claude" }];

  it("describes rules for chips", () => {
    expect(sidebarTitleRuleText(rule({ id: "a", pattern: " bot- " }))).toBe("Hide bot-");
    expect(
      sidebarTitleRuleText(rule({ id: "a", mode: "only", pattern: "^fix", regex: true })),
    ).toBe("Only /^fix/");
  });

  it("names the trigger and counts live filters", () => {
    const rules = [
      rule({ id: "a", pattern: "bot-" }),
      rule({ id: "b", mode: "only", pattern: "^fix", regex: true }),
      rule({ id: "c", pattern: "off", enabled: false }),
    ];
    const compiled = compileSidebarTitleRules(rules);
    expect(sidebarEnhancedFilterButtonLabel({ rules, accountKey: "acct", accountOptions })).toBe(
      'Enhanced filter: hide "bot-", only /^fix/, Autimo Claude',
    );
    expect(sidebarEnhancedFilterButtonLabel({ rules: [], accountKey: null, accountOptions })).toBe(
      "Enhanced filter",
    );
    expect(
      sidebarEnhancedFilterButtonLabel({ rules: [], accountKey: "gone", accountOptions }),
    ).toBe("Enhanced filter: Unavailable account");
    expect(sidebarEnhancedFilterBadgeCount(compiled, "acct")).toBe(3);
  });

  it("has content for any non-blank rule or an account", () => {
    expect(
      hasSidebarEnhancedFilterContent([rule({ id: "a", enabled: false, pattern: "x" })], null),
    ).toBe(true);
    expect(hasSidebarEnhancedFilterContent([rule({ id: "a" })], null)).toBe(false);
    expect(hasSidebarEnhancedFilterContent([], "acct")).toBe(true);
  });
});
