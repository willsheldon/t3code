/**
 * The enhanced thread list filter on mobile: status, account and several projects. The status,
 * account key and matching rules are the web sidebar's, shared through
 * `@t3tools/client-runtime/state/thread-filters`; this file adds how the mobile list applies them.
 */
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  compileThreadTitleRules,
  countThreadFilterStatuses,
  hasLiveThreadFilters,
  matchesThreadFilters,
  resolveThreadFilterStatus,
  threadAccountKey,
  type ThreadFilterStatus,
  type ThreadFilterStatusCounts,
} from "@t3tools/client-runtime/state/thread-filters";
import {
  isListedThreadLineage,
  type EnvironmentId,
  type ScopedProjectRef,
  type ServerProvider,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import { resolveScratchProjectScopeKey } from "@t3tools/client-runtime/state/project-grouping";

import { scopedThreadKey } from "../../lib/scopedEntities";
import type { HomeProjectScope } from "./homeThreadList";

// The mobile filter has no title rules yet, so nothing here hides a thread by its title.
const NO_TITLE_RULES = compileThreadTitleRules([]);

export type ThreadListFilterSelection = {
  readonly statuses: ReadonlyArray<ThreadFilterStatus>;
  readonly accountKey: string | null;
};

/** Whether the status or account selection can hide a thread. */
export const hasThreadListFilter = (selection: ThreadListFilterSelection): boolean =>
  hasLiveThreadFilters({ compiled: NO_TITLE_RULES, ...selection });

const statusOf = (thread: EnvironmentThreadShell) => resolveThreadFilterStatus(thread);

/**
 * The threads the status and account selection leaves in the list. The open thread stays, so
 * a filter never takes the screen's thread out from under the reader. Returns `threads` itself
 * when nothing is selected, so the list pipeline keeps its identity.
 */
export function filterThreadsForList(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  selection: ThreadListFilterSelection,
  openThreadKey: string | null,
): ReadonlyArray<EnvironmentThreadShell> {
  if (!hasThreadListFilter(selection)) return threads;
  return threads.filter((thread) =>
    matchesThreadFilters(thread, {
      compiled: NO_TITLE_RULES,
      accountKey: selection.accountKey,
      isOpen: scopedThreadKey(thread.environmentId, thread.id) === openThreadKey,
      status: { selected: selection.statuses, of: statusOf },
    }),
  );
}

export type ThreadListScope = {
  readonly environmentId: EnvironmentId | null;
  /** `environmentId:projectId` keys, or null for every project. */
  readonly projectKeys: ReadonlySet<string> | null;
};

export function projectRefKeys(
  projectRefs: ReadonlyArray<ScopedProjectRef> | null,
): ReadonlySet<string> | null {
  return projectRefs === null
    ? null
    : new Set(projectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`));
}

export function isThreadInListScope(
  thread: EnvironmentThreadShell,
  scope: ThreadListScope,
): boolean {
  return (
    thread.archivedAt === null &&
    isListedThreadLineage(thread.lineage) &&
    (scope.environmentId === null || thread.environmentId === scope.environmentId) &&
    (scope.projectKeys === null ||
      scope.projectKeys.has(`${thread.environmentId}:${thread.projectId}`))
  );
}

/**
 * How many threads each status would show. A count ignores the status selection, so it says
 * what selecting that status adds, and it respects the scope and the account.
 */
export function countThreadListStatuses(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  scope: ThreadListScope,
  accountKey: string | null,
): ThreadFilterStatusCounts {
  return countThreadFilterStatuses(
    threads.filter(
      (thread) =>
        isThreadInListScope(thread, scope) &&
        matchesThreadFilters(thread, { compiled: NO_TITLE_RULES, accountKey, isOpen: false }),
    ),
    statusOf,
  );
}

export type ThreadListAccountOption = { readonly key: string; readonly label: string };

/**
 * The accounts the listed threads run on, named as the web sidebar names them: the provider
 * instance, with the environment appended when there are several.
 */
export function threadListAccountOptions(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly providersByEnvironmentId: ReadonlyMap<
    EnvironmentId,
    ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "displayName">>
  >;
  readonly environmentLabelById: ReadonlyMap<EnvironmentId, string>;
}): ReadonlyArray<ThreadListAccountOption> {
  const options = new Map<string, ThreadListAccountOption>();
  for (const thread of input.threads) {
    if (thread.archivedAt !== null || !isListedThreadLineage(thread.lineage)) continue;
    const key = threadAccountKey(thread);
    if (options.has(key)) continue;
    const provider = input.providersByEnvironmentId
      .get(thread.environmentId)
      ?.find((candidate) => candidate.instanceId === thread.providerInstanceId);
    const name =
      provider === undefined
        ? String(thread.providerInstanceId)
        : resolveProviderInstanceDisplayName(provider);
    const environment = input.environmentLabelById.get(thread.environmentId);
    options.set(key, {
      key,
      label:
        input.environmentLabelById.size > 1 && environment !== undefined
          ? `${name} · ${environment}`
          : name,
    });
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export type ResolvedProjectFilter = {
  /** The scopes the stored keys name, in the order they were chosen. */
  readonly scopes: ReadonlyArray<HomeProjectScope>;
  readonly keys: ReadonlyArray<string>;
  /** The projects the list is limited to, or null for every project. */
  readonly projectRefs: ReadonlyArray<ScopedProjectRef> | null;
};

/**
 * Turns the stored project keys into the scopes the list can show. A legacy per-environment
 * scratch key resolves here; a project that is archived, gone, or outside the chosen
 * environment reads as not chosen, as one archived project did before. The stored keys stay
 * as they are until the user picks again.
 */
export function resolveProjectFilter(input: {
  readonly keys: ReadonlyArray<string>;
  readonly projects: Parameters<typeof resolveScratchProjectScopeKey>[1];
  /** Pickable scopes: archived projects are already left out. */
  readonly scopes: ReadonlyArray<HomeProjectScope>;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
}): ResolvedProjectFilter {
  const chosen: HomeProjectScope[] = [];
  for (const key of input.keys) {
    const resolved = resolveScratchProjectScopeKey(key, input.projects, {
      sidebarProjectGroupingMode: input.projectGroupingMode,
      sidebarProjectGroupingOverrides: {},
    });
    const scope = input.scopes.find((candidate) => candidate.key === resolved);
    if (scope !== undefined && !chosen.includes(scope)) chosen.push(scope);
  }
  return {
    scopes: chosen,
    keys: chosen.map((scope) => scope.key),
    // One scope keeps its own refs array, so the list pipeline sees the same identity as before.
    projectRefs:
      chosen.length === 0
        ? null
        : chosen.length === 1
          ? chosen[0]!.projectRefs
          : chosen.flatMap((scope) => scope.projectRefs),
  };
}

/**
 * The one project the filter names, for places that need a single project. Several chosen
 * projects, or none, name no project and behave as All projects does.
 */
export function soleProjectScope(scopes: ReadonlyArray<HomeProjectScope>): HomeProjectScope | null {
  return scopes.length === 1 ? scopes[0]! : null;
}

export function toggleProjectKey(keys: ReadonlyArray<string>, key: string): ReadonlyArray<string> {
  return keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key];
}
