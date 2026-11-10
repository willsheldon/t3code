import {
  THREAD_FILTER_GUARD_MESSAGE,
  THREAD_FILTER_PASS_KEY,
  compileThreadTitleRules,
  newThreadTitleRule,
  resolveThreadFilterStatus,
  type ThreadFilterStore,
  type ThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "../../test-fixtures";
import { buildThreadListV2Items } from "../threads/threadListV2";
import type { HomeProjectScope } from "./homeThreadList";
import {
  countThreadListStatuses,
  filterThreadsForList,
  hasThreadListFilter,
  projectRefKeys,
  resolveProjectFilter,
  soleProjectScope,
  threadListAccountOptions,
  toggleProjectKey,
  tripHungTitleRules,
} from "./thread-list-filters";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");
const CODEX = ProviderInstanceId.make("codex");
const CLAUDE = ProviderInstanceId.make("claudeAgent");
const run = (status: "completed" | "failed" | "running") =>
  ({
    runId: "run-1",
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: status === "running" ? null : "2026-01-02T00:00:00.000Z",
  }) as never;

type Status = "input" | "working" | "failed" | "done";
const OVERRIDES: Record<Status, Partial<EnvironmentThreadShell>> = {
  input: { hasPendingUserInput: true },
  working: { runtime: { status: "running", activeRunId: null } as never },
  failed: { latestRun: run("failed"), runtime: { status: "failed" } as never, lastVisitedAt: null },
  done: { latestRun: run("completed"), runtime: { status: "idle" } as never },
};

function thread(
  id: string,
  status: Status,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  const made = makeThreadShellFixture({
    environmentId: ENV_A,
    id: ThreadId.make(id),
    title: id,
    providerInstanceId: CODEX,
    ...OVERRIDES[status],
    ...overrides,
  });
  // The fixture must land in the status the test names, or the cases below prove nothing.
  expect(resolveThreadFilterStatus(made)).toBe(status);
  return made;
}

const key = (value: EnvironmentThreadShell) => `${value.environmentId}:${value.id}`;

describe("filterThreadsForList", () => {
  const threads = [
    thread("a-input", "input"),
    thread("a-working", "working"),
    thread("a-failed", "failed"),
    thread("a-done", "done"),
    thread("b-done", "done", { environmentId: ENV_B, providerInstanceId: CLAUDE }),
  ];

  it("returns the same list when nothing is selected", () => {
    expect(filterThreadsForList(threads, { statuses: [], accountKey: null }, null)).toBe(threads);
  });

  it("keeps threads in any selected status", () => {
    const filtered = filterThreadsForList(
      threads,
      { statuses: ["input", "working"], accountKey: null },
      null,
    );
    expect(filtered.map((entry) => entry.title)).toEqual(["a-input", "a-working"]);
  });

  it("limits to one account", () => {
    const accountKey = JSON.stringify([ENV_B, CLAUDE]);
    expect(
      filterThreadsForList(threads, { statuses: [], accountKey }, null).map((entry) => entry.title),
    ).toEqual(["b-done"]);
  });

  it("combines status and account", () => {
    const accountKey = JSON.stringify([ENV_A, CODEX]);
    expect(
      filterThreadsForList(threads, { statuses: ["done"], accountKey }, null).map(
        (entry) => entry.title,
      ),
    ).toEqual(["a-done"]);
  });

  it("keeps the open thread whatever the filter says", () => {
    const filtered = filterThreadsForList(
      threads,
      { statuses: ["failed"], accountKey: null },
      key(threads[0]!),
    );
    expect(filtered.map((entry) => entry.title)).toEqual(["a-input", "a-failed"]);
  });

  it("follows into the list sections, counts and settled paging", () => {
    const settled = ["s-1", "s-2", "s-3"].map((id) =>
      thread(id, "done", { settledOverride: "settled" }),
    );
    const all = [...threads, ...settled];
    const filtered = filterThreadsForList(all, { statuses: ["working"], accountKey: null }, null);
    const layout = buildThreadListV2Items({
      threads: filtered as EnvironmentThreadShell[],
      environmentId: null,
      searchQuery: "",
      now: "2026-06-01T00:00:00.000Z",
      settledLimit: 1,
      settledShelfExpanded: true,
    });
    expect(layout.items.map((item) => item.thread.title)).toEqual(["a-working"]);
    expect(layout.settledCount).toBe(0);
    expect(layout.hiddenSettledCount).toBe(0);

    const doneOnly = buildThreadListV2Items({
      threads: filterThreadsForList(
        all,
        { statuses: ["done"], accountKey: null },
        null,
      ) as EnvironmentThreadShell[],
      environmentId: null,
      searchQuery: "",
      now: "2026-06-01T00:00:00.000Z",
      settledLimit: 1,
      settledShelfExpanded: true,
    });
    // The two unsettled Done threads list as rows; the three settled ones page behind the limit.
    expect(doneOnly.settledCount).toBe(3);
    expect(doneOnly.hiddenSettledCount).toBe(2);
  });
});

function memoryStore(): ThreadFilterStore & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}
const rule = (id: string, patch: Partial<ThreadTitleRule>): ThreadTitleRule => ({
  ...newThreadTitleRule(id),
  ...patch,
});

describe("title rules in the list", () => {
  const titled = ["Fix login", "fix: search", "Add docs", "WIP login"].map((title) =>
    thread(title, "done", { title }),
  );
  const titles = (rules: ThreadTitleRule[], open: string | null = null) =>
    filterThreadsForList(titled, { statuses: [], accountKey: null, rules }, open).map(
      (entry) => entry.title,
    );

  it("filters only when a rule is live", () => {
    expect(hasThreadListFilter({ statuses: [], accountKey: null, rules: [] })).toBe(false);
    expect(
      hasThreadListFilter({
        statuses: [],
        accountKey: null,
        rules: [rule("a", { pattern: " " }), rule("b", { pattern: "x", enabled: false })],
      }),
    ).toBe(false);
    expect(
      hasThreadListFilter({ statuses: [], accountKey: null, rules: [rule("a", { pattern: "x" })] }),
    ).toBe(true);
    expect(filterThreadsForList(titled, { statuses: [], accountKey: null, rules: [] }, null)).toBe(
      titled,
    );
  });

  it("hides matches, ignoring case, and keeps only matches", () => {
    expect(titles([rule("a", { pattern: "LOGIN" })])).toEqual(["fix: search", "Add docs"]);
    expect(titles([rule("a", { mode: "only", pattern: "login" })])).toEqual([
      "Fix login",
      "WIP login",
    ]);
  });

  it("combines rules as the web sidebar does: no Hide match, and any Only match", () => {
    expect(
      titles([
        rule("a", { mode: "only", pattern: "login" }),
        rule("b", { mode: "only", pattern: "docs" }),
        rule("c", { pattern: "^wip", regex: true }),
      ]),
    ).toEqual(["Fix login", "Add docs"]);
  });

  it("ignores an invalid regex and a tripped rule", () => {
    expect(titles([rule("a", { pattern: "(", regex: true })])).toEqual(titles([]));
    expect(titles([rule("a", { pattern: "fix", enabled: false, tripped: true })])).toHaveLength(4);
  });

  it("keeps the open thread and combines with status", () => {
    expect(titles([rule("a", { mode: "only", pattern: "docs" })], key(titled[0]!))).toEqual([
      "Fix login",
      "Add docs",
    ]);
    const mixed = [
      thread("a", "done", { title: "alpha" }),
      thread("b", "done", { title: "beta" }),
      thread("c", "working", { title: "gamma" }),
    ];
    expect(
      filterThreadsForList(
        mixed,
        { statuses: ["done"], accountKey: null, rules: [rule("a", { pattern: "al" })] },
        null,
      ).map((entry) => entry.title),
    ).toEqual(["beta"]);
  });

  it("writes the pass marker before matching and clears it after", () => {
    const store = memoryStore();
    const writes: string[] = [];
    const recording: ThreadFilterStore = {
      ...store,
      setItem: (key, value) => {
        writes.push(key);
        store.setItem(key, value);
      },
    };
    titles([rule("a", { pattern: "fix", regex: true })]);
    filterThreadsForList(
      titled,
      { statuses: [], accountKey: null, rules: [rule("a", { pattern: "wip", regex: true })] },
      null,
      recording,
    );
    expect(writes).toEqual([THREAD_FILTER_PASS_KEY]);
    expect(store.items.size).toBe(0);
  });

  it("counts statuses within the title rules", () => {
    const everything = { environmentId: null, projectKeys: null };
    expect(
      countThreadListStatuses(titled, everything, null, [rule("a", { pattern: "login" })]),
    ).toMatchObject({ done: 2 });
    expect(countThreadListStatuses(titled, everything, null)).toMatchObject({ done: 4 });
  });
});

describe("tripHungTitleRules", () => {
  const regex = rule("a", { pattern: "(a+)+$", regex: true });
  const plain = rule("b", { pattern: "wip" });
  const marker = (at: number) =>
    JSON.stringify({ fingerprint: JSON.stringify([["a", "(a+)+$"]]), at });

  it("turns off the regex rules of a pass that never finished, and clears the marker", () => {
    const store = memoryStore();
    store.items.set(THREAD_FILTER_PASS_KEY, marker(0));
    const tripped = tripHungTitleRules([regex, plain], store, () => "id", 10_000);
    expect(tripped).toEqual([{ ...regex, enabled: false, tripped: true }, plain]);
    expect(store.items.size).toBe(0);
    expect(compileThreadTitleRules(tripped).errors.get("a")).toBe(THREAD_FILTER_GUARD_MESSAGE);
  });

  it("returns the same rules when no pass was left behind", () => {
    const rules = [regex, plain];
    expect(tripHungTitleRules(rules, memoryStore(), () => "id")).toBe(rules);
  });

  it("leaves a recent pass alone and never writes the rules into the store", () => {
    const store = memoryStore();
    store.items.set(THREAD_FILTER_PASS_KEY, marker(9_500));
    const rules = [regex];
    expect(tripHungTitleRules(rules, store, () => "id", 10_000)).toBe(rules);
    expect([...store.items.keys()]).toEqual([THREAD_FILTER_PASS_KEY]);
  });
});

describe("countThreadListStatuses", () => {
  const threads = [
    thread("a-input", "input"),
    thread("a-working-1", "working"),
    thread("a-working-2", "working"),
    thread("a-done", "done", { projectId: ProjectId.make("project-2") }),
    thread("archived-done", "done", { archivedAt: "2026-01-03T00:00:00.000Z" }),
    thread("b-failed", "failed", { environmentId: ENV_B, providerInstanceId: CLAUDE }),
  ];
  const everything = { environmentId: null, projectKeys: null };

  it("counts every status and skips archived threads", () => {
    expect(countThreadListStatuses(threads, everything, null)).toEqual({
      input: 1,
      working: 2,
      failed: 1,
      done: 1,
    });
  });

  it("respects the environment, the projects and the account", () => {
    expect(countThreadListStatuses(threads, { ...everything, environmentId: ENV_B }, null)).toEqual(
      { input: 0, working: 0, failed: 1, done: 0 },
    );
    const project = projectRefKeys([
      { environmentId: ENV_A, projectId: ProjectId.make("project-2") },
    ]);
    expect(
      countThreadListStatuses(threads, { environmentId: null, projectKeys: project }, null),
    ).toEqual({ input: 0, working: 0, failed: 0, done: 1 });
    expect(countThreadListStatuses(threads, everything, JSON.stringify([ENV_B, CLAUDE]))).toEqual({
      input: 0,
      working: 0,
      failed: 1,
      done: 0,
    });
  });
});

describe("threadListAccountOptions", () => {
  const threads = [
    thread("a-1", "done"),
    thread("a-2", "working"),
    thread("b-1", "done", { environmentId: ENV_B, providerInstanceId: CLAUDE }),
    thread("hidden", "done", {
      providerInstanceId: ProviderInstanceId.make("other"),
      archivedAt: "x",
    }),
  ];
  const providers = new Map<EnvironmentId, never[]>([
    [ENV_A, [{ instanceId: CODEX, driver: "codex", displayName: "Codex" } as never]],
    [ENV_B, [{ instanceId: CLAUDE, driver: "claudeAgent", displayName: "Claude" } as never]],
  ]);

  it("lists each account once, with its environment when there are several", () => {
    const options = threadListAccountOptions({
      threads,
      providersByEnvironmentId: providers,
      environmentLabelById: new Map([
        [ENV_A, "Laptop"],
        [ENV_B, "Server"],
      ]),
    });
    expect(options).toEqual([
      { key: JSON.stringify([ENV_B, CLAUDE]), label: "Claude · Server" },
      { key: JSON.stringify([ENV_A, CODEX]), label: "Codex · Laptop" },
    ]);
  });

  it("leaves the environment out when there is one", () => {
    const options = threadListAccountOptions({
      threads,
      providersByEnvironmentId: providers,
      environmentLabelById: new Map([[ENV_A, "Laptop"]]),
    });
    expect(options.map((option) => option.label)).toEqual(["Claude", "Codex"]);
  });

  it("names an account by its instance id when the provider list is missing", () => {
    const options = threadListAccountOptions({
      threads: [threads[0]!],
      providersByEnvironmentId: new Map<EnvironmentId, never[]>(),
      environmentLabelById: new Map<EnvironmentId, string>(),
    });
    expect(options.map((option) => option.label)).toEqual(["codex"]);
  });
});

describe("project filter", () => {
  const ref = (environmentId: EnvironmentId, projectId: string): ScopedProjectRef => ({
    environmentId,
    projectId: ProjectId.make(projectId),
  });
  const scope = (key: string, refs: ScopedProjectRef[]) =>
    ({ key, title: key, projectRefs: refs }) as unknown as HomeProjectScope;
  const alpha = scope("alpha", [ref(ENV_A, "p-1"), ref(ENV_B, "p-1")]);
  const beta = scope("beta", [ref(ENV_A, "p-2")]);
  const resolve = (keys: string[]) =>
    resolveProjectFilter({
      keys,
      projects: [],
      scopes: [alpha, beta],
      projectGroupingMode: "repository",
    });

  it("is every project when none is chosen", () => {
    expect(resolve([])).toEqual({ scopes: [], keys: [], projectRefs: null });
  });

  it("keeps the refs of one scope as they are", () => {
    expect(resolve(["beta"]).projectRefs).toBe(beta.projectRefs);
  });

  it("joins the refs of several scopes in the order chosen", () => {
    const filter = resolve(["beta", "alpha", "beta"]);
    expect(filter.keys).toEqual(["beta", "alpha"]);
    expect(filter.projectRefs).toEqual([...beta.projectRefs, ...alpha.projectRefs]);
  });

  it("drops a project that is gone or archived, and reads all projects when none is left", () => {
    expect(resolve(["gone", "alpha"]).keys).toEqual(["alpha"]);
    expect(resolve(["gone"])).toEqual({ scopes: [], keys: [], projectRefs: null });
  });

  it("names one project only when exactly one is chosen", () => {
    expect(soleProjectScope(resolve(["beta"]).scopes)).toBe(beta);
    expect(soleProjectScope(resolve([]).scopes)).toBeNull();
    expect(soleProjectScope(resolve(["alpha", "beta"]).scopes)).toBeNull();
  });

  it("toggles a key in and out of the list", () => {
    expect(toggleProjectKey([], "a")).toEqual(["a"]);
    expect(toggleProjectKey(["a", "b"], "a")).toEqual(["b"]);
  });
});
