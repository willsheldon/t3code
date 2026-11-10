import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  ThreadFilterStatus,
  ThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useOlderSettledShelf } from "../../state/olderSettledShelf";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import { olderSettledScopes, unloadedSettled } from "../threads/useThreadListV2";
import type { HomeListFilterMenuEnhanced } from "./home-list-filter-menu";
import { useAtomValueWhileVisible } from "./home-route-visibility";
import { threadFilterGuardStore } from "./thread-filter-guard-store";
import {
  countThreadListStatuses,
  projectRefKeys,
  threadListAccountOptions,
} from "./thread-list-filters";

/**
 * What the status and account menus show, or null while the enhanced filter is off. The counts
 * and account list walk every thread, so nothing is computed when it is off. Pass `enabled:
 * false` as well where the menus are not shown. `visible` stops reading the environments atom
 * while Home sits under a pushed Thread.
 */
export function useEnhancedThreadFilterMenu(input: {
  readonly enabled: boolean;
  readonly visible?: boolean;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef> | null;
  readonly statuses: ReadonlyArray<ThreadFilterStatus>;
  readonly accountKey: string | null;
  readonly rules: ReadonlyArray<ThreadTitleRule>;
}): HomeListFilterMenuEnhanced | null {
  const { enabled, threads } = input;
  const { providersByEnvironmentId, settlementEnvironmentIds } = useAtomValueWhileVisible(
    threadListEnvironmentsAtom,
    enabled && (input.visible ?? true),
  );
  const accountOptions = useMemo(
    () =>
      enabled
        ? threadListAccountOptions({
            threads,
            providersByEnvironmentId,
            environmentLabelById: new Map(
              input.environments.map((environment) => [
                environment.environmentId,
                environment.label,
              ]),
            ),
          })
        : [],
    [enabled, threads, providersByEnvironmentId, input.environments],
  );
  const statusCounts = useMemo(
    () =>
      enabled
        ? countThreadListStatuses(
            threads,
            { environmentId: input.environmentId, projectKeys: projectRefKeys(input.projectRefs) },
            input.accountKey,
            input.rules,
            threadFilterGuardStore,
          )
        : null,
    [enabled, threads, input.environmentId, input.projectRefs, input.accountKey, input.rules],
  );
  // A collapsed shelf mounts no pages; this only reads how many older settled threads exist.
  const scopes = useMemo(
    () =>
      enabled
        ? olderSettledScopes({
            environmentId: input.environmentId,
            projectRefs: input.projectRefs,
            settlementEnvironmentIds,
          })
        : [],
    [enabled, input.environmentId, input.projectRefs, settlementEnvironmentIds],
  );
  const { unloadedCount } = useOlderSettledShelf({ scopes, expanded: false, visibleCount: 0 });
  const doneHasMore = useMemo(
    () => enabled && unloadedSettled(threads, scopes, unloadedCount) > 0,
    [enabled, threads, scopes, unloadedCount],
  );
  return useMemo(
    () =>
      enabled
        ? {
            statuses: input.statuses,
            statusCounts,
            doneHasMore,
            accountOptions,
            selectedAccountKey: input.accountKey,
            rules: input.rules,
          }
        : null,
    [
      enabled,
      input.statuses,
      statusCounts,
      doneHasMore,
      accountOptions,
      input.accountKey,
      input.rules,
    ],
  );
}
