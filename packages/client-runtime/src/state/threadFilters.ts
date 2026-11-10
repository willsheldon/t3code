// @effect-diagnostics globalDate:off - Synchronous filter code for React and native render paths, outside an Effect runtime.
/**
 * Thread filters shared by web and mobile: status, title rules and account.
 * Regex matching runs between a pass marker's write and removal, so the next
 * start can turn off a pattern that hung the renderer.
 */
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { isLatestRunSettled, type EnvironmentThreadShell } from "./models.ts";

export const THREAD_FILTER_KEY = "t3code:sidebar:enhanced-filter";
export const THREAD_FILTER_PASS_KEY = "t3code:sidebar:enhanced-filter:pass";
export const LEGACY_THREAD_TITLE_FILTER_KEY = "t3code:sidebar:title-filter";
export const THREAD_TITLE_RULE_LIMIT = 20;
const THREAD_FILTER_GUARD_MIN_AGE_MS = 2_000;
export const THREAD_FILTER_GUARD_MESSAGE =
  "Turned off: this pattern made the sidebar unresponsive.";

export const ThreadTitleRuleSchema = Schema.Struct({
  id: Schema.String,
  mode: Schema.Literals(["hide", "only"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("hide" as const)),
  ),
  pattern: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  regex: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  tripped: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type ThreadTitleRule = typeof ThreadTitleRuleSchema.Type;

export const ThreadFilterStoredSchema = Schema.Struct({
  rules: Schema.Array(ThreadTitleRuleSchema).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ThreadFilterStored = typeof ThreadFilterStoredSchema.Type;
export const EMPTY_THREAD_FILTER: ThreadFilterStored = { rules: [] };

const LegacyTitleFilterSchema = Schema.Struct({
  text: Schema.String,
  mode: Schema.Literals(["include", "exclude"]),
});
const PassMarkerSchema = Schema.Struct({ fingerprint: Schema.String, at: Schema.Number });

/**
 * The storage calls the filter makes; `window.localStorage` satisfies it, and
 * so does any synchronous store a native client wraps around its own storage.
 */
export type ThreadFilterStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const decodeJson = <T, E>(schema: Schema.Codec<T, E>, raw: string): T =>
  Schema.decodeSync(Schema.fromJsonString(schema))(raw);
const encodeJson = <T, E>(schema: Schema.Codec<T, E>, value: T): string =>
  Schema.encodeSync(Schema.fromJsonString(schema))(value);

// Storage can be missing, blocked or full. The filter must keep working, so
// every access is best-effort.
const storeGet = (store: ThreadFilterStore | null, key: string): string | null => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const storeSet = (store: ThreadFilterStore | null, key: string, value: string): void => {
  try {
    store?.setItem(key, value);
  } catch {
    // Best-effort; see storeGet.
  }
};
const storeRemove = (store: ThreadFilterStore | null, key: string): void => {
  try {
    store?.removeItem(key);
  } catch {
    // Best-effort; see storeGet.
  }
};

export function newThreadTitleRule(id: string): ThreadTitleRule {
  return { id, mode: "hide", pattern: "", regex: false, enabled: true, tripped: false };
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The compiled expression, or the parser's error message. */
function compileRegex(pattern: string): RegExp | string {
  try {
    return new RegExp(pattern, "i");
  } catch (error) {
    return errorMessage(error);
  }
}

/** Whether a rule currently filters: on, not tripped, non-blank, and valid. */
export function isThreadTitleRuleLive(rule: ThreadTitleRule): boolean {
  if (!rule.enabled || rule.tripped || rule.pattern.trim() === "") return false;
  return !rule.regex || typeof compileRegex(rule.pattern) !== "string";
}

/** Identifies the live regex rules; empty when none can run. */
export function threadTitleRulesFingerprint(rules: ReadonlyArray<ThreadTitleRule>): string {
  const live = rules.filter((rule) => rule.regex && isThreadTitleRuleLive(rule));
  return live.length === 0 ? "" : JSON.stringify(live.map((rule) => [rule.id, rule.pattern]));
}

type TitleMatcher = (title: string) => boolean;

export type CompiledThreadTitleRules = {
  readonly hide: ReadonlyArray<TitleMatcher>;
  readonly only: ReadonlyArray<TitleMatcher>;
  /** Error per rule id: parse errors, the guard message, and regex runtime errors. */
  readonly errors: Map<string, string>;
  readonly liveCount: number;
  /** See `threadTitleRulesFingerprint`. */
  readonly fingerprint: string;
  /** Changes only when the live rules change; feeds selection and paging reset keys. */
  readonly liveKey: string;
  /** Title to pass or fail under these rules. */
  readonly cache: Map<string, boolean>;
};

let lastCompiledTitleRules: {
  readonly key: string;
  readonly compiled: CompiledThreadTitleRules;
} | null = null;

// Returns the same compiled rules, and so the same title cache, while the rules are unchanged.
// The sidebar calls this every render with a freshly decoded rules array, and the React
// Compiler does not memoize the call, so the key is the rules' content, not their identity.
export function compileThreadTitleRules(
  rules: ReadonlyArray<ThreadTitleRule>,
): CompiledThreadTitleRules {
  const key = JSON.stringify(rules);
  if (lastCompiledTitleRules?.key === key) return lastCompiledTitleRules.compiled;
  const compiled = compileThreadTitleRulesUncached(rules);
  lastCompiledTitleRules = { key, compiled };
  return compiled;
}

function compileThreadTitleRulesUncached(
  rules: ReadonlyArray<ThreadTitleRule>,
): CompiledThreadTitleRules {
  const hide: TitleMatcher[] = [];
  const only: TitleMatcher[] = [];
  const errors = new Map<string, string>();
  const liveParts: Array<[string, boolean, string]> = [];
  for (const rule of rules) {
    if (rule.tripped) errors.set(rule.id, THREAD_FILTER_GUARD_MESSAGE);
    const trimmed = rule.pattern.trim();
    if (trimmed === "") continue;
    let matcher: TitleMatcher;
    if (rule.regex) {
      const regexp = compileRegex(rule.pattern);
      if (typeof regexp === "string") {
        if (!rule.tripped) errors.set(rule.id, regexp);
        continue;
      }
      matcher = (title) => {
        try {
          return regexp.test(title);
        } catch (error) {
          errors.set(rule.id, errorMessage(error));
          return false;
        }
      };
    } else {
      const needle = trimmed.toLocaleLowerCase();
      matcher = (title) => title.toLocaleLowerCase().includes(needle);
    }
    if (!rule.enabled || rule.tripped) continue;
    (rule.mode === "hide" ? hide : only).push(matcher);
    liveParts.push([
      rule.mode,
      rule.regex,
      rule.regex ? rule.pattern : trimmed.toLocaleLowerCase(),
    ]);
  }
  return {
    hide,
    only,
    errors,
    liveCount: hide.length + only.length,
    fingerprint: threadTitleRulesFingerprint(rules),
    liveKey: liveParts.length === 0 ? "" : JSON.stringify(liveParts),
    cache: new Map(),
  };
}

export function matchesThreadTitleRules(
  compiled: CompiledThreadTitleRules,
  title: string,
): boolean {
  if (compiled.liveCount === 0) return true;
  const cached = compiled.cache.get(title);
  if (cached !== undefined) return cached;
  const result =
    !compiled.hide.some((matches) => matches(title)) &&
    (compiled.only.length === 0 || compiled.only.some((matches) => matches(title)));
  compiled.cache.set(title, result);
  return result;
}

/**
 * Matches every uncached title before the list filters. When a regex rule
 * is live, the matching runs between writing and removing the pass marker, in
 * one synchronous block, so only a pass that never finished leaves it behind.
 */
export function warmThreadTitleRuleCache(
  compiled: CompiledThreadTitleRules,
  titles: Iterable<string>,
  store: ThreadFilterStore | null,
  now = Date.now(),
): void {
  if (compiled.liveCount === 0) return;
  const guarded = compiled.fingerprint !== "";
  let marked = false;
  try {
    for (const title of titles) {
      if (compiled.cache.has(title)) continue;
      if (guarded && !marked) {
        storeSet(
          store,
          THREAD_FILTER_PASS_KEY,
          encodeJson(PassMarkerSchema, { fingerprint: compiled.fingerprint, at: now }),
        );
        marked = true;
      }
      matchesThreadTitleRules(compiled, title);
    }
  } finally {
    if (marked) storeRemove(store, THREAD_FILTER_PASS_KEY);
  }
}

const THREAD_FILTER_STATUSES = ["input", "working", "failed", "done"] as const;
export type ThreadFilterStatus = (typeof THREAD_FILTER_STATUSES)[number];
export const ThreadFilterStatusesSchema = Schema.Array(Schema.Literals(THREAD_FILTER_STATUSES));
export const NO_THREAD_FILTER_STATUSES: ReadonlyArray<ThreadFilterStatus> = [];
export type ThreadFilterStatusCounts = Readonly<Record<ThreadFilterStatus, number>>;

export const THREAD_FILTER_STATUS_OPTIONS: ReadonlyArray<{
  readonly value: ThreadFilterStatus;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "input",
    label: "Input",
    description: "Waiting on you: input, an approval, a guest or a plan",
  },
  {
    value: "working",
    label: "Working",
    description: "Running, connecting or waiting on other work",
  },
  {
    value: "failed",
    label: "Failed",
    description: "Failed runs you have not opened yet",
  },
  {
    value: "done",
    label: "Done",
    description: "Last run finished and nothing is pending",
  },
];

export const threadFilterStatusOption = (status: ThreadFilterStatus) =>
  THREAD_FILTER_STATUS_OPTIONS.find((option) => option.value === status) ??
  THREAD_FILTER_STATUS_OPTIONS[0]!;

/** Toggles one status and keeps the stored order canonical, so reset keys stay stable. */
export function toggleThreadFilterStatus(
  selected: ReadonlyArray<ThreadFilterStatus>,
  status: ThreadFilterStatus,
): ReadonlyArray<ThreadFilterStatus> {
  return THREAD_FILTER_STATUSES.filter((candidate) =>
    candidate === status ? !selected.includes(candidate) : selected.includes(candidate),
  );
}

/** The shell fields a status depends on; `undefined` stands for an older server. */
export type ThreadFilterStatusInput = Pick<
  EnvironmentThreadShell,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "pendingGuestMessageCount"
  | "interactionMode"
  | "latestRun"
  | "runtime"
> & {
  readonly lastVisitedAt?: string | null | undefined;
  readonly pendingBackgroundTasks?: EnvironmentThreadShell["pendingBackgroundTasks"] | undefined;
  readonly blockedOnThreadWait?: boolean | undefined;
};

/** Whether the latest run finished after the thread was last opened; never for an unopened thread. */
export function hasUnseenCompletion(
  thread: Pick<ThreadFilterStatusInput, "latestRun" | "lastVisitedAt">,
): boolean {
  if (!thread.latestRun?.completedAt) return false;
  const completedAt = Date.parse(thread.latestRun.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return false;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

/** Unopened threads' failures still count as unseen, unlike completions. */
export function hasUnseenFailure(
  thread: Pick<ThreadFilterStatusInput, "latestRun" | "lastVisitedAt">,
): boolean {
  if (thread.latestRun?.status !== "failed") return false;
  if (!thread.lastVisitedAt) return true;
  const completedAt = Date.parse(thread.latestRun.completedAt ?? "");
  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(completedAt) || Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

/**
 * The filter a thread belongs to, from the same state the web sidebar row's
 * status pill reads; the checks run in the pill's order. Done is wider than
 * the Completed pill, which clears once the thread is opened. A failed run the
 * user has already opened belongs to no filter.
 */
export function resolveThreadFilterStatus(
  thread: ThreadFilterStatusInput,
): ThreadFilterStatus | null {
  if (
    thread.hasPendingApprovals ||
    thread.pendingSubagentRequest === "approval" ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest === "user_input" ||
    (thread.pendingGuestMessageCount ?? 0) > 0
  ) {
    return "input";
  }

  const runtimeStatus = thread.runtime?.status;
  if (
    runtimeStatus === "running" ||
    runtimeStatus === "waiting" ||
    runtimeStatus === "preparing" ||
    runtimeStatus === "starting" ||
    runtimeStatus === "queued" ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])
  ) {
    // Running while blocked on another thread, and held background work, show as Waiting.
    return "working";
  }

  if (hasUnseenFailure(thread)) return "failed";

  const hasPlanReadyPrompt =
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestRunSettled(thread.latestRun, thread.runtime) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) return "input";

  if (hasUnseenCompletion(thread)) return "done";

  return thread.latestRun?.status !== "failed" &&
    isLatestRunSettled(thread.latestRun, thread.runtime)
    ? "done"
    : null;
}

export function countThreadFilterStatuses<T>(
  threads: ReadonlyArray<T>,
  statusOf: (thread: T) => ThreadFilterStatus | null,
): ThreadFilterStatusCounts {
  const counts = { input: 0, working: 0, failed: 0, done: 0 };
  for (const thread of threads) {
    const status = statusOf(thread);
    if (status !== null) counts[status] += 1;
  }
  return counts;
}

/** Identifies a thread's environment and provider account; stored as the account filter. */
export function threadAccountKey(thread: {
  readonly environmentId: string;
  readonly providerInstanceId: string;
}): string {
  return JSON.stringify([thread.environmentId, thread.providerInstanceId]);
}

/**
 * Shown for a stored account the current environments no longer offer: in the
 * account select, its chip, and its trigger name.
 */
export const UNAVAILABLE_ACCOUNT_LABEL = "Unavailable account";

/** Whether any filter can currently hide a thread. */
export const hasLiveThreadFilters = (input: {
  readonly compiled: CompiledThreadTitleRules;
  readonly accountKey: string | null;
  readonly statuses: ReadonlyArray<ThreadFilterStatus>;
}): boolean =>
  input.compiled.liveCount > 0 || input.accountKey !== null || input.statuses.length > 0;

export function matchesThreadFilters<
  T extends {
    readonly title: string;
    readonly environmentId: string;
    readonly providerInstanceId: string;
  },
>(
  thread: T,
  filters: {
    readonly compiled: CompiledThreadTitleRules;
    readonly accountKey: string | null;
    readonly isOpen: boolean;
    /** Left out to match on everything but status, as the status counts do. */
    readonly status?: {
      readonly selected: ReadonlyArray<ThreadFilterStatus>;
      readonly of: (thread: T) => ThreadFilterStatus | null;
    };
  },
): boolean {
  if (filters.isOpen) return true;
  if (!matchesThreadTitleRules(filters.compiled, thread.title)) return false;
  if (filters.accountKey !== null && threadAccountKey(thread) !== filters.accountKey) {
    return false;
  }
  if (filters.status === undefined || filters.status.selected.length === 0) return true;
  const status = filters.status.of(thread);
  return status !== null && filters.status.selected.includes(status);
}

/** The single-field filter from earlier builds, as one rule. */
export function migrateLegacyThreadTitleFilter(
  raw: string | null,
  newId: () => string,
): ThreadFilterStored {
  if (raw === null) return EMPTY_THREAD_FILTER;
  try {
    const legacy = decodeJson(LegacyTitleFilterSchema, raw);
    const pattern = legacy.text.trim();
    if (pattern === "") return EMPTY_THREAD_FILTER;
    return {
      rules: [
        {
          ...newThreadTitleRule(newId()),
          mode: legacy.mode === "exclude" ? "hide" : "only",
          pattern,
        },
      ],
    };
  } catch {
    return EMPTY_THREAD_FILTER;
  }
}

/**
 * Runs once, during the first render and before the rules are read: drops
 * corrupt data, migrates the legacy filter, and trips the regex rules of a
 * pass that never finished.
 */
export function initializeThreadFilter(
  store: ThreadFilterStore | null,
  newId: () => string,
  now = Date.now(),
): ThreadFilterStored {
  let current = EMPTY_THREAD_FILTER;
  const raw = storeGet(store, THREAD_FILTER_KEY);
  if (raw === null) {
    const migrated = migrateLegacyThreadTitleFilter(
      storeGet(store, LEGACY_THREAD_TITLE_FILTER_KEY),
      newId,
    );
    if (migrated.rules.length > 0) {
      current = migrated;
      storeSet(store, THREAD_FILTER_KEY, encodeJson(ThreadFilterStoredSchema, migrated));
    }
  } else {
    try {
      current = decodeJson(ThreadFilterStoredSchema, raw);
    } catch {
      // Left in place, it would make every later write fail its re-read.
      storeRemove(store, THREAD_FILTER_KEY);
    }
  }

  const markerRaw = storeGet(store, THREAD_FILTER_PASS_KEY);
  if (markerRaw === null) return current;
  let marker: typeof PassMarkerSchema.Type;
  try {
    marker = decodeJson(PassMarkerSchema, markerRaw);
  } catch {
    storeRemove(store, THREAD_FILTER_PASS_KEY);
    return current;
  }
  // Another tab may be mid-pass; a real hang is older by the time anyone reloads.
  if (now - marker.at < THREAD_FILTER_GUARD_MIN_AGE_MS) return current;
  storeRemove(store, THREAD_FILTER_PASS_KEY);
  if (
    marker.fingerprint === "" ||
    marker.fingerprint !== threadTitleRulesFingerprint(current.rules)
  ) {
    return current;
  }
  const trippedIds = new Set(
    current.rules
      .filter((rule) => rule.regex && isThreadTitleRuleLive(rule))
      .map((rule) => rule.id),
  );
  const tripped: ThreadFilterStored = {
    rules: current.rules.map((rule) =>
      trippedIds.has(rule.id) ? { ...rule, enabled: false, tripped: true } : rule,
    ),
  };
  storeSet(store, THREAD_FILTER_KEY, encodeJson(ThreadFilterStoredSchema, tripped));
  return tripped;
}

type Rules = ReadonlyArray<ThreadTitleRule>;

/** Returns `rules` itself when `id` is gone, so a late debounced save is a no-op. */
export function updateThreadTitleRule(
  rules: Rules,
  id: string,
  patch: Partial<Omit<ThreadTitleRule, "id">>,
): Rules {
  let changed = false;
  const next = rules.map((rule) => {
    if (rule.id !== id) return rule;
    changed = true;
    return { ...rule, ...patch };
  });
  return changed ? next : rules;
}

export const setThreadTitleRulePattern = (rules: Rules, id: string, pattern: string): Rules =>
  updateThreadTitleRule(rules, id, { pattern, tripped: false });

export const setThreadTitleRuleEnabled = (rules: Rules, id: string, enabled: boolean): Rules =>
  updateThreadTitleRule(rules, id, enabled ? { enabled, tripped: false } : { enabled });

/** Inserts after `afterId`, or appends; unchanged at the rule limit. */
export function insertThreadTitleRule(
  rules: Rules,
  afterId: string | null,
  rule: ThreadTitleRule,
): Rules {
  if (rules.length >= THREAD_TITLE_RULE_LIMIT) return rules;
  const index = afterId === null ? -1 : rules.findIndex((candidate) => candidate.id === afterId);
  if (index === -1) return [...rules, rule];
  return [...rules.slice(0, index + 1), rule, ...rules.slice(index + 1)];
}

export function removeThreadTitleRule(rules: Rules, id: string): Rules {
  const next = rules.filter((rule) => rule.id !== id);
  return next.length === rules.length ? rules : next;
}

/** The rule whose input takes focus after `id` is removed, if any. */
export function threadTitleRuleFocusAfterRemoval(rules: Rules, id: string): string | null {
  const index = rules.findIndex((rule) => rule.id === id);
  if (index === -1) return null;
  return rules[index - 1]?.id ?? rules[index + 1]?.id ?? null;
}

export function threadTitleRuleText(rule: ThreadTitleRule): string {
  const pattern = rule.pattern.trim();
  return `${rule.mode === "hide" ? "Hide" : "Only"} ${rule.regex ? `/${pattern}/` : pattern}`;
}
