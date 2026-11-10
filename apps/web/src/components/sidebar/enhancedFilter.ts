/**
 * Web-only parts of the enhanced sidebar filter: status colours, the trigger's
 * name and badge, the project list narrowing and the settled-shelf counts. The
 * filtering itself lives in `@t3tools/client-runtime/state/thread-filters`, shared with mobile.
 */
import {
  UNAVAILABLE_ACCOUNT_LABEL,
  isThreadTitleRuleLive,
  threadFilterStatusOption,
  type CompiledThreadTitleRules,
  type ThreadFilterStatus,
  type ThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";

export const SIDEBAR_STATUS_FILTER_KEY = "t3code:sidebar:enhanced-filter:statuses";

export const SIDEBAR_STATUS_DOT_CLASS: Readonly<Record<ThreadFilterStatus, string>> = {
  input: "bg-indigo-500 dark:bg-indigo-300/90",
  working: "bg-sky-500 dark:bg-sky-300/80",
  failed: "bg-red-500 dark:bg-red-300/90",
  done: "bg-emerald-500 dark:bg-emerald-300/90",
};

type Rules = ReadonlyArray<ThreadTitleRule>;

/**
 * Accessible name for the trigger. The count badge is decorative, so this is
 * where a screen reader learns what is filtered.
 */
export function sidebarEnhancedFilterButtonLabel(input: {
  readonly rules: Rules;
  readonly accountKey: string | null;
  readonly accountOptions: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly projectNames: ReadonlyArray<string>;
  readonly statuses?: ReadonlyArray<ThreadFilterStatus>;
}): string {
  const parts = [
    ...(input.statuses ?? []).map((status) => threadFilterStatusOption(status).label),
    ...input.projectNames,
  ];
  for (const rule of input.rules.filter(isThreadTitleRuleLive)) {
    const pattern = rule.pattern.trim();
    parts.push(`${rule.mode} ${rule.regex ? `/${pattern}/` : `"${pattern}"`}`);
  }
  if (input.accountKey !== null) {
    parts.push(
      input.accountOptions.find((option) => option.key === input.accountKey)?.label ??
        UNAVAILABLE_ACCOUNT_LABEL,
    );
  }
  return parts.length === 0 ? "Enhanced filter" : `Enhanced filter: ${parts.join(", ")}`;
}

export const sidebarEnhancedFilterBadgeCount = (
  compiled: CompiledThreadTitleRules,
  accountKey: string | null,
  projectCount: number,
  statusCount = 0,
): number => compiled.liveCount + (accountKey === null ? 0 : 1) + projectCount + statusCount;

/** Whether the chip row has anything to show, including rules that are off or invalid. */
export const hasSidebarEnhancedFilterContent = (
  rules: Rules,
  accountKey: string | null,
  projectCount: number,
  statusCount = 0,
): boolean =>
  statusCount > 0 ||
  projectCount > 0 ||
  accountKey !== null ||
  rules.some((rule) => rule.pattern.trim() !== "");

/** Narrows the filter's project list by name. */
export function filterSidebarProjectOptions<T extends { readonly label: string }>(
  options: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return options;
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}

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
