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
    });
    expect(decodeStoredThreadListFilters({ environmentId: null, projectKey: null })).toEqual({
      environmentId: null,
      projectKeys: [],
      statuses: [],
      accountKey: null,
    });
  });

  it("round-trips the saved selection", () => {
    const saved = {
      environmentId: "env-1",
      projectKeys: ["a", "b"],
      statuses: ["input", "done"],
      accountKey: '["env-1","codex"]',
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
    ).toEqual({ environmentId: null, projectKeys: ["a"], statuses: [], accountKey: null });
    expect(decodeStoredThreadListFilters({ environmentId: "env-1", accountKey: 4 })).toEqual({
      environmentId: "env-1",
      projectKeys: [],
      statuses: [],
      accountKey: null,
    });
  });

  it("returns nothing for a value that is not a record", () => {
    for (const value of [null, undefined, "x", 4, [], ["a"]]) {
      expect(decodeStoredThreadListFilters(value)).toBeUndefined();
    }
  });
});
