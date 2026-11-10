import type { ThreadFilterStatus } from "@t3tools/client-runtime/state/thread-filters";
import type { EnvironmentId, SidebarProjectGroupingMode } from "@t3tools/contracts";
import { DEFAULT_SIDEBAR_PROJECT_SORT_ORDER } from "@t3tools/contracts";
import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { createContext, createElement, useContext, useState, type PropsWithChildren } from "react";

import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import type { HomeProjectSortOrder } from "./homeThreadList";

export interface HomeListOptions {
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKeys: ReadonlyArray<string>;
  readonly selectedStatuses: ReadonlyArray<ThreadFilterStatus>;
  readonly selectedAccountKey: string | null;
  readonly projectSortOrder: HomeProjectSortOrder;
}

export interface ResolvedHomeListOptions extends HomeListOptions {
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  /** Whether status, account and several projects filter the list. */
  readonly enhancedFilterEnabled: boolean;
}

const NO_PROJECT_KEYS: ReadonlyArray<string> = [];
const NO_STATUSES: ReadonlyArray<ThreadFilterStatus> = [];

function defaultHomeListOptions(filters?: ThreadListFilters): HomeListOptions {
  return {
    selectedEnvironmentId: filters?.environmentId ?? null,
    selectedProjectKeys: filters?.projectKeys ?? NO_PROJECT_KEYS,
    selectedStatuses: filters?.statuses ?? NO_STATUSES,
    selectedAccountKey: filters?.accountKey ?? null,
    projectSortOrder:
      DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
        ? "updated_at"
        : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  };
}

interface HomeListOptionsContextValue {
  readonly options: HomeListOptions;
  readonly updateOptions: (patch: Partial<HomeListOptions>) => void;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly enhancedFilterEnabled: boolean;
}

const HomeListOptionsContext = createContext<HomeListOptionsContextValue | null>(null);

export function HomeListOptionsProvider({
  children,
  projectGroupingMode,
  enhancedFilterEnabled = true,
  savedFilters,
}: PropsWithChildren<{
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly enhancedFilterEnabled?: boolean;
  readonly savedFilters?: ThreadListFilters | undefined;
}>) {
  const registry = useContext(RegistryContext);
  const [optionsAtom] = useState(() => Atom.make(defaultHomeListOptions(savedFilters)));
  const options = useAtomValue(optionsAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  // Only the scope persists; the sort order is per session. Updates read the
  // registry, so several in one event each build on the last and save it.
  const updateOptions = (patch: Partial<HomeListOptions>) => {
    const current = registry.get(optionsAtom);
    const next = { ...current, ...patch };
    registry.set(optionsAtom, next);
    if (
      next.selectedEnvironmentId !== current.selectedEnvironmentId ||
      next.selectedProjectKeys !== current.selectedProjectKeys ||
      next.selectedStatuses !== current.selectedStatuses ||
      next.selectedAccountKey !== current.selectedAccountKey
    ) {
      savePreferences({
        threadListFilters: {
          environmentId: next.selectedEnvironmentId,
          projectKeys: next.selectedProjectKeys,
          statuses: next.selectedStatuses,
          accountKey: next.selectedAccountKey,
        },
      });
    }
  };
  const value = { options, updateOptions, projectGroupingMode, enhancedFilterEnabled };
  return createElement(HomeListOptionsContext, { value }, children);
}

export function useHomeListOptions(availableEnvironmentIds: ReadonlySet<EnvironmentId>) {
  const shared = useContext(HomeListOptionsContext);
  const [localOptions, setLocalOptions] = useState<HomeListOptions>(defaultHomeListOptions);
  const options = shared?.options ?? localOptions;
  const updateOptions =
    shared?.updateOptions ??
    ((patch: Partial<HomeListOptions>) => setLocalOptions((current) => ({ ...current, ...patch })));
  const selectedEnvironmentId =
    options.selectedEnvironmentId !== null &&
    availableEnvironmentIds.has(options.selectedEnvironmentId)
      ? options.selectedEnvironmentId
      : null;
  const availableOptions =
    selectedEnvironmentId === options.selectedEnvironmentId
      ? options
      : { ...options, selectedEnvironmentId };
  const enhancedFilterEnabled = shared?.enhancedFilterEnabled ?? true;
  // Off means the list behaves as it did before the enhanced filter: one project, and no
  // status or account filtering. The saved choices come back when it is turned on.
  const resolvedOptions: ResolvedHomeListOptions = {
    ...availableOptions,
    ...(enhancedFilterEnabled
      ? {}
      : {
          selectedProjectKeys:
            availableOptions.selectedProjectKeys.length <= 1
              ? availableOptions.selectedProjectKeys
              : availableOptions.selectedProjectKeys.slice(0, 1),
          selectedStatuses: NO_STATUSES,
          selectedAccountKey: null,
        }),
    projectGroupingMode: shared?.projectGroupingMode ?? "repository",
    enhancedFilterEnabled,
  };

  const setSelectedEnvironmentId = (value: EnvironmentId | null) => {
    updateOptions({ selectedEnvironmentId: value });
  };
  const setSelectedProjectKeys = (value: ReadonlyArray<string>) => {
    updateOptions({ selectedProjectKeys: value.length === 0 ? NO_PROJECT_KEYS : value });
  };
  const setSelectedStatuses = (value: ReadonlyArray<ThreadFilterStatus>) => {
    updateOptions({ selectedStatuses: value.length === 0 ? NO_STATUSES : value });
  };
  const setSelectedAccountKey = (value: string | null) => {
    updateOptions({ selectedAccountKey: value });
  };
  // Clears what the menus show. While the enhanced filter is off the saved status and account
  // are hidden, so they stay for when it is turned on again.
  const resetFilters = () => {
    updateOptions({
      selectedEnvironmentId: null,
      selectedProjectKeys: NO_PROJECT_KEYS,
      ...(enhancedFilterEnabled ? { selectedStatuses: NO_STATUSES, selectedAccountKey: null } : {}),
    });
  };
  const setProjectSortOrder = (value: HomeProjectSortOrder) => {
    updateOptions({ projectSortOrder: value });
  };
  return {
    options: resolvedOptions,
    setSelectedEnvironmentId,
    setSelectedProjectKeys,
    setSelectedStatuses,
    setSelectedAccountKey,
    resetFilters,
    setProjectSortOrder,
  } as const;
}
