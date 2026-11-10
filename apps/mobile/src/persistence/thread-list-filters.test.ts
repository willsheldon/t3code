import { THREAD_TITLE_RULE_LIMIT } from "@t3tools/client-runtime/state/thread-filters";
import { describe, expect, it } from "vite-plus/test";

import { decodeStoredThreadListFilters } from "./thread-list-filters";

describe("decodeStoredThreadListFilters", () => {
  it("keeps the saved project of an earlier build as a one-project list", () => {
    expect(
      decodeStoredThreadListFilters({ environmentId: "env-1", projectKey: "env-1:project-1" }),
    ).toEqual({
      environmentId: "env-1",
      projectKeys: ["env-1:project-1"],
      statuses: [],
      accountKey: null,
      rules: [],
    });
    expect(decodeStoredThreadListFilters({ environmentId: null, projectKey: null })).toEqual({
      environmentId: null,
      projectKeys: [],
      statuses: [],
      accountKey: null,
      rules: [],
    });
  });

  it("round-trips the saved selection", () => {
    const saved = {
      environmentId: "env-1",
      projectKeys: ["a", "b"],
      statuses: ["input", "done"],
      accountKey: '["env-1","codex"]',
      rules: [
        { id: "r1", mode: "only", pattern: "^fix", regex: true, enabled: false, tripped: true },
      ],
    };
    expect(decodeStoredThreadListFilters(saved)).toEqual(saved);
  });

  it("prefers the list over a leftover single key", () => {
    expect(
      decodeStoredThreadListFilters({ projectKey: "old", projectKeys: ["new-1", "new-2"] })
        ?.projectKeys,
    ).toEqual(["new-1", "new-2"]);
  });

  it("orders statuses canonically and drops duplicates and unknown values", () => {
    expect(
      decodeStoredThreadListFilters({ statuses: ["done", "bogus", 7, "input", "done"] })?.statuses,
    ).toEqual(["input", "done"]);
  });

  it("decodes a corrupt field to its default and keeps the others", () => {
    expect(
      decodeStoredThreadListFilters({
        environmentId: 12,
        projectKeys: ["a", 3, "", null, "a"],
        statuses: "working",
        accountKey: { key: 1 },
      }),
    ).toEqual({
      environmentId: null,
      projectKeys: ["a"],
      statuses: [],
      accountKey: null,
      rules: [],
    });
    expect(decodeStoredThreadListFilters({ environmentId: "env-1", accountKey: 4 })).toEqual({
      environmentId: "env-1",
      projectKeys: [],
      statuses: [],
      accountKey: null,
      rules: [],
    });
  });

  it("decodes a record saved before title rules to no rules", () => {
    expect(
      decodeStoredThreadListFilters({
        environmentId: null,
        projectKeys: ["a"],
        statuses: ["done"],
        accountKey: null,
      })?.rules,
    ).toEqual([]);
  });

  it("fills a rule's missing fields and drops rules that cannot decode or repeat an id", () => {
    expect(
      decodeStoredThreadListFilters({
        rules: [
          { id: "a", pattern: "wip" },
          { pattern: "no id" },
          "x",
          { id: "a", pattern: "dup" },
        ],
      })?.rules,
    ).toEqual([
      { id: "a", mode: "hide", pattern: "wip", regex: false, enabled: true, tripped: false },
    ]);
    expect(decodeStoredThreadListFilters({ rules: "nope" })?.rules).toEqual([]);
  });

  it("keeps at most the rule limit", () => {
    const rules = Array.from({ length: 30 }, (_, index) => ({ id: `r${index}`, pattern: "x" }));
    expect(decodeStoredThreadListFilters({ rules })?.rules).toHaveLength(THREAD_TITLE_RULE_LIMIT);
  });

  it("returns nothing for a value that is not a record", () => {
    for (const value of [null, undefined, "x", 4, [], ["a"]]) {
      expect(decodeStoredThreadListFilters(value)).toBeUndefined();
    }
  });
});
