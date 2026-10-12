/**
 * Enhanced sidebar filter: title rules (plain text or regular expressions) plus
 * an account, stored per device. Matching results are cached per title, and a
 * marker written around uncached regex matching lets the next start turn off a
 * pattern that hung the renderer, so a bad regex can never lock the sidebar.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL, sidebarThreadAccountKey } from "../Sidebar.logic";

export const SIDEBAR_ENHANCED_FILTER_KEY = "t3code:sidebar:enhanced-filter";
export const SIDEBAR_ENHANCED_FILTER_PASS_KEY = "t3code:sidebar:enhanced-filter:pass";
export const LEGACY_SIDEBAR_TITLE_FILTER_KEY = "t3code:sidebar:title-filter";
export const SIDEBAR_TITLE_RULE_LIMIT = 20;
export const SIDEBAR_FILTER_GUARD_MIN_AGE_MS = 2_000;
export const SIDEBAR_FILTER_GUARD_MESSAGE =
  "Turned off: this pattern made the sidebar unresponsive.";

export const SidebarTitleRuleSchema = Schema.Struct({
  id: Schema.String,
  mode: Schema.Literals(["hide", "only"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("hide" as const)),
  ),
  pattern: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  regex: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  tripped: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type SidebarTitleRule = typeof SidebarTitleRuleSchema.Type;

export const SidebarEnhancedFilterStoredSchema = Schema.Struct({
  rules: Schema.Array(SidebarTitleRuleSchema).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type SidebarEnhancedFilterStored = typeof SidebarEnhancedFilterStoredSchema.Type;
export const EMPTY_SIDEBAR_ENHANCED_FILTER: SidebarEnhancedFilterStored = { rules: [] };

const LegacyTitleFilterSchema = Schema.Struct({
  text: Schema.String,
  mode: Schema.Literals(["include", "exclude"]),
});
const PassMarkerSchema = Schema.Struct({ fingerprint: Schema.String, at: Schema.Number });

/** The storage calls the filter makes; `window.localStorage` satisfies it. */
export type SidebarFilterStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const decodeJson = <T, E>(schema: Schema.Codec<T, E>, raw: string): T =>
  Schema.decodeSync(Schema.fromJsonString(schema))(raw);
const encodeJson = <T, E>(schema: Schema.Codec<T, E>, value: T): string =>
  Schema.encodeSync(Schema.fromJsonString(schema))(value);

// Storage can be missing, blocked or full. The filter must keep working, so
// every access is best-effort.
const storeGet = (store: SidebarFilterStore | null, key: string): string | null => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const storeSet = (store: SidebarFilterStore | null, key: string, value: string): void => {
  try {
    store?.setItem(key, value);
  } catch {
    // Best-effort; see storeGet.
  }
};
const storeRemove = (store: SidebarFilterStore | null, key: string): void => {
  try {
    store?.removeItem(key);
  } catch {
    // Best-effort; see storeGet.
  }
};

export function newSidebarTitleRule(id: string): SidebarTitleRule {
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
export function isSidebarTitleRuleLive(rule: SidebarTitleRule): boolean {
  if (!rule.enabled || rule.tripped || rule.pattern.trim() === "") return false;
  return !rule.regex || typeof compileRegex(rule.pattern) !== "string";
}

/** Identifies the live regex rules; empty when none can run. */
export function sidebarTitleRulesFingerprint(rules: ReadonlyArray<SidebarTitleRule>): string {
  const live = rules.filter((rule) => rule.regex && isSidebarTitleRuleLive(rule));
  return live.length === 0 ? "" : JSON.stringify(live.map((rule) => [rule.id, rule.pattern]));
}

type TitleMatcher = (title: string) => boolean;

export type CompiledSidebarTitleRules = {
  readonly hide: ReadonlyArray<TitleMatcher>;
  readonly only: ReadonlyArray<TitleMatcher>;
  /** Error per rule id: parse errors, the guard message, and regex runtime errors. */
  readonly errors: Map<string, string>;
  readonly liveCount: number;
  /** See `sidebarTitleRulesFingerprint`. */
  readonly fingerprint: string;
  /** Changes only when the live rules change; feeds selection and paging reset keys. */
  readonly liveKey: string;
  /** Title to pass or fail under these rules. */
  readonly cache: Map<string, boolean>;
};

export function compileSidebarTitleRules(
  rules: ReadonlyArray<SidebarTitleRule>,
): CompiledSidebarTitleRules {
  const hide: TitleMatcher[] = [];
  const only: TitleMatcher[] = [];
  const errors = new Map<string, string>();
  const liveParts: Array<[string, boolean, string]> = [];
  for (const rule of rules) {
    if (rule.tripped) errors.set(rule.id, SIDEBAR_FILTER_GUARD_MESSAGE);
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
    fingerprint: sidebarTitleRulesFingerprint(rules),
    liveKey: liveParts.length === 0 ? "" : JSON.stringify(liveParts),
    cache: new Map(),
  };
}

export function matchesSidebarTitleRules(
  compiled: CompiledSidebarTitleRules,
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
 * Matches every uncached title before the sidebar filters. When a regex rule
 * is live, the matching runs between writing and removing the pass marker, in
 * one synchronous block, so only a pass that never finished leaves it behind.
 */
export function warmSidebarTitleRuleCache(
  compiled: CompiledSidebarTitleRules,
  titles: Iterable<string>,
  store: SidebarFilterStore | null,
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
          SIDEBAR_ENHANCED_FILTER_PASS_KEY,
          encodeJson(PassMarkerSchema, { fingerprint: compiled.fingerprint, at: now }),
        );
        marked = true;
      }
      matchesSidebarTitleRules(compiled, title);
    }
  } finally {
    if (marked) storeRemove(store, SIDEBAR_ENHANCED_FILTER_PASS_KEY);
  }
}

export function matchesSidebarThreadFilters(
  thread: {
    readonly title: string;
    readonly environmentId: string;
    readonly providerInstanceId: string;
  },
  filters: {
    readonly compiled: CompiledSidebarTitleRules;
    readonly accountKey: string | null;
    readonly isOpen: boolean;
  },
): boolean {
  return (
    filters.isOpen ||
    (matchesSidebarTitleRules(filters.compiled, thread.title) &&
      (filters.accountKey === null || sidebarThreadAccountKey(thread) === filters.accountKey))
  );
}

/** The single-field filter from earlier builds, as one rule. */
export function migrateLegacySidebarTitleFilter(
  raw: string | null,
  newId: () => string,
): SidebarEnhancedFilterStored {
  if (raw === null) return EMPTY_SIDEBAR_ENHANCED_FILTER;
  try {
    const legacy = decodeJson(LegacyTitleFilterSchema, raw);
    const pattern = legacy.text.trim();
    if (pattern === "") return EMPTY_SIDEBAR_ENHANCED_FILTER;
    return {
      rules: [
        {
          ...newSidebarTitleRule(newId()),
          mode: legacy.mode === "exclude" ? "hide" : "only",
          pattern,
        },
      ],
    };
  } catch {
    return EMPTY_SIDEBAR_ENHANCED_FILTER;
  }
}

/**
 * Runs once, during the sidebar's first render and before it reads the rules:
 * drops corrupt data, migrates the legacy filter, and trips the regex rules of
 * a pass that never finished.
 */
export function initializeSidebarEnhancedFilter(
  store: SidebarFilterStore | null,
  newId: () => string,
  now = Date.now(),
): SidebarEnhancedFilterStored {
  let current = EMPTY_SIDEBAR_ENHANCED_FILTER;
  const raw = storeGet(store, SIDEBAR_ENHANCED_FILTER_KEY);
  if (raw === null) {
    const migrated = migrateLegacySidebarTitleFilter(
      storeGet(store, LEGACY_SIDEBAR_TITLE_FILTER_KEY),
      newId,
    );
    if (migrated.rules.length > 0) {
      current = migrated;
      storeSet(
        store,
        SIDEBAR_ENHANCED_FILTER_KEY,
        encodeJson(SidebarEnhancedFilterStoredSchema, migrated),
      );
    }
  } else {
    try {
      current = decodeJson(SidebarEnhancedFilterStoredSchema, raw);
    } catch {
      // Left in place, it would make every later write fail its re-read.
      storeRemove(store, SIDEBAR_ENHANCED_FILTER_KEY);
    }
  }

  const markerRaw = storeGet(store, SIDEBAR_ENHANCED_FILTER_PASS_KEY);
  if (markerRaw === null) return current;
  let marker: typeof PassMarkerSchema.Type;
  try {
    marker = decodeJson(PassMarkerSchema, markerRaw);
  } catch {
    storeRemove(store, SIDEBAR_ENHANCED_FILTER_PASS_KEY);
    return current;
  }
  // Another tab may be mid-pass; a real hang is older by the time anyone reloads.
  if (now - marker.at < SIDEBAR_FILTER_GUARD_MIN_AGE_MS) return current;
  storeRemove(store, SIDEBAR_ENHANCED_FILTER_PASS_KEY);
  if (
    marker.fingerprint === "" ||
    marker.fingerprint !== sidebarTitleRulesFingerprint(current.rules)
  ) {
    return current;
  }
  const trippedIds = new Set(
    current.rules
      .filter((rule) => rule.regex && isSidebarTitleRuleLive(rule))
      .map((rule) => rule.id),
  );
  const tripped: SidebarEnhancedFilterStored = {
    rules: current.rules.map((rule) =>
      trippedIds.has(rule.id) ? { ...rule, enabled: false, tripped: true } : rule,
    ),
  };
  storeSet(
    store,
    SIDEBAR_ENHANCED_FILTER_KEY,
    encodeJson(SidebarEnhancedFilterStoredSchema, tripped),
  );
  return tripped;
}

type Rules = ReadonlyArray<SidebarTitleRule>;

/** Returns `rules` itself when `id` is gone, so a late debounced save is a no-op. */
export function updateSidebarTitleRule(
  rules: Rules,
  id: string,
  patch: Partial<Omit<SidebarTitleRule, "id">>,
): Rules {
  let changed = false;
  const next = rules.map((rule) => {
    if (rule.id !== id) return rule;
    changed = true;
    return { ...rule, ...patch };
  });
  return changed ? next : rules;
}

export const setSidebarTitleRulePattern = (rules: Rules, id: string, pattern: string): Rules =>
  updateSidebarTitleRule(rules, id, { pattern, tripped: false });

export const setSidebarTitleRuleEnabled = (rules: Rules, id: string, enabled: boolean): Rules =>
  updateSidebarTitleRule(rules, id, enabled ? { enabled, tripped: false } : { enabled });

/** Inserts after `afterId`, or appends; unchanged at the rule limit. */
export function insertSidebarTitleRule(
  rules: Rules,
  afterId: string | null,
  rule: SidebarTitleRule,
): Rules {
  if (rules.length >= SIDEBAR_TITLE_RULE_LIMIT) return rules;
  const index = afterId === null ? -1 : rules.findIndex((candidate) => candidate.id === afterId);
  if (index === -1) return [...rules, rule];
  return [...rules.slice(0, index + 1), rule, ...rules.slice(index + 1)];
}

export function removeSidebarTitleRule(rules: Rules, id: string): Rules {
  const next = rules.filter((rule) => rule.id !== id);
  return next.length === rules.length ? rules : next;
}

/** The rule whose input takes focus after `id` is removed, if any. */
export function sidebarTitleRuleFocusAfterRemoval(rules: Rules, id: string): string | null {
  const index = rules.findIndex((rule) => rule.id === id);
  if (index === -1) return null;
  return rules[index - 1]?.id ?? rules[index + 1]?.id ?? null;
}

export function sidebarTitleRuleText(rule: SidebarTitleRule): string {
  const pattern = rule.pattern.trim();
  return `${rule.mode === "hide" ? "Hide" : "Only"} ${rule.regex ? `/${pattern}/` : pattern}`;
}

/**
 * Accessible name for the trigger. The count badge is decorative, so this is
 * where a screen reader learns what is filtered.
 */
export function sidebarEnhancedFilterButtonLabel(input: {
  readonly rules: Rules;
  readonly accountKey: string | null;
  readonly accountOptions: ReadonlyArray<{ readonly key: string; readonly label: string }>;
}): string {
  const parts = input.rules.filter(isSidebarTitleRuleLive).map((rule) => {
    const pattern = rule.pattern.trim();
    return `${rule.mode} ${rule.regex ? `/${pattern}/` : `"${pattern}"`}`;
  });
  if (input.accountKey !== null) {
    parts.push(
      input.accountOptions.find((option) => option.key === input.accountKey)?.label ??
        SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL,
    );
  }
  return parts.length === 0 ? "Enhanced filter" : `Enhanced filter: ${parts.join(", ")}`;
}

export const sidebarEnhancedFilterBadgeCount = (
  compiled: CompiledSidebarTitleRules,
  accountKey: string | null,
): number => compiled.liveCount + (accountKey === null ? 0 : 1);

/** Whether the chip row has anything to show, including rules that are off or invalid. */
export const hasSidebarEnhancedFilterContent = (rules: Rules, accountKey: string | null): boolean =>
  accountKey !== null || rules.some((rule) => rule.pattern.trim() !== "");

// Unloaded history has no titles to match yet; keep its shelf reachable without counting it as matches.
export function sidebarSettledFilterCounts(input: {
  readonly matched: number;
  readonly visible: number;
  readonly unloaded: number;
  readonly filtering: boolean;
}) {
  const count = input.matched + (input.filtering ? 0 : input.unloaded);
  return {
    count,
    hidden: Math.max(0, count - input.visible),
    hasUnloaded: input.filtering && input.unloaded > 0,
  };
}

export function sidebarSettledPageThreads<T>(
  scanned: readonly T[],
  matched: readonly T[],
  isListed: (thread: T) => boolean,
) {
  return { listedThreads: matched.filter(isListed), growthThreads: scanned.filter(isListed) };
}
