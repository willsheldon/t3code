import type {
  ThreadFilterStatus,
  ThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";
import type { EnvironmentId, SidebarProjectGroupingMode } from "@t3tools/contracts";
import { DEFAULT_SIDEBAR_PROJECT_SORT_ORDER } from "@t3tools/contracts";
import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { uuidv4 } from "../../lib/uuid";
import type { ThreadListFilters } from "../../persistence/mobile-preferences";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { threadFilterGuardStore } from "./thread-filter-guard-store";
import type { HomeProjectSortOrder } from "./homeThreadList";
import { tripHungTitleRules } from "./thread-list-filters";

export interface HomeListOptions {
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKeys: ReadonlyArray<string>;
  readonly selectedStatuses: ReadonlyArray<ThreadFilterStatus>;
  readonly selectedAccountKey: string | null;
  readonly titleRules: ReadonlyArray<ThreadTitleRule>;
  readonly projectSortOrder: HomeProjectSortOrder;
}

export interface ResolvedHomeListOptions extends HomeListOptions {
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  /** Whether status, account, title rules and several projects filter the list. */
  readonly enhancedFilterEnabled: boolean;
}

const NO_PROJECT_KEYS: ReadonlyArray<string> = [];
const NO_STATUSES: ReadonlyArray<ThreadFilterStatus> = [];
const NO_TITLE_RULES: ReadonlyArray<ThreadTitleRule> = [];

function defaultHomeListOptions(filters?: ThreadListFilters): HomeListOptions {
  return {
    selectedEnvironmentId: filters?.environmentId ?? null,
    selectedProjectKeys: filters?.projectKeys ?? NO_PROJECT_KEYS,
    selectedStatuses: filters?.statuses ?? NO_STATUSES,
    selectedAccountKey: filters?.accountKey ?? null,
    titleRules: filters?.rules ?? NO_TITLE_RULES,
    projectSortOrder:
      DEFAULT_SIDEBAR_PROJECT_SORT_ORDER === "manual"
        ? "updated_at"
        : DEFAULT_SIDEBAR_PROJECT_SORT_ORDER,
  };
}

/** A patch, or one built from the options as they are when it runs (for edits queued behind a pause). */
type OptionsUpdate =
  | Partial<HomeListOptions>
  | ((current: HomeListOptions) => Partial<HomeListOptions>);
const applyUpdate = (current: HomeListOptions, update: OptionsUpdate): HomeListOptions => ({
  ...current,
  ...(typeof update === "function" ? update(current) : update),
});

interface HomeListOptionsContextValue {
  readonly options: HomeListOptions;
  readonly updateOptions: (patch: OptionsUpdate) => void;
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
  // A regex rule that hung the app last time is turned off before the first list render.
  const [{ optionsAtom, trippedRules }] = useState(() => {
    const options = defaultHomeListOptions(savedFilters);
    const rules = tripHungTitleRules(options.titleRules, threadFilterGuardStore, uuidv4);
    const tripped = rules !== options.titleRules;
    return {
      optionsAtom: Atom.make(tripped ? { ...options, titleRules: rules } : options),
      trippedRules: tripped ? rules : null,
    };
  });
  const options = useAtomValue(optionsAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  // The guard cleared its marker, so the tripped state must be saved or the next start would
  // turn the rule back on.
  const tripSaved = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the guard's one-time trip to the saved preferences once they have loaded; the guard already cleared its marker.
  useEffect(() => {
    if (trippedRules === null || savedFilters === undefined || tripSaved.current) return;
    tripSaved.current = true;
    savePreferences({ threadListFilters: { ...savedFilters, rules: trippedRules } });
  }, [trippedRules, savedFilters, savePreferences]);
  // Only the scope persists; the sort order is per session. Updates read the
  // registry, so several in one event each build on the last and save it.
  const updateOptions = (update: OptionsUpdate) => {
    const current = registry.get(optionsAtom);
    const next = applyUpdate(current, update);
    registry.set(optionsAtom, next);
    if (
      next.selectedEnvironmentId !== current.selectedEnvironmentId ||
      next.selectedProjectKeys !== current.selectedProjectKeys ||
      next.selectedStatuses !== current.selectedStatuses ||
      next.selectedAccountKey !== current.selectedAccountKey ||
      next.titleRules !== current.titleRules
    ) {
      savePreferences({
        threadListFilters: {
          environmentId: next.selectedEnvironmentId,
          projectKeys: next.selectedProjectKeys,
          statuses: next.selectedStatuses,
          accountKey: next.selectedAccountKey,
          rules: next.titleRules,
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
    ((update: OptionsUpdate) => setLocalOptions((current) => applyUpdate(current, update)));
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
  // status, account or title rule filtering. The saved choices come back when it is turned on.
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
          titleRules: NO_TITLE_RULES,
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
  // Takes the edit, not the rules: a rule's pattern is saved after typing pauses, by when other
  // rules may have changed.
  const setTitleRules = (
    edit: (rules: ReadonlyArray<ThreadTitleRule>) => ReadonlyArray<ThreadTitleRule>,
  ) => {
    updateOptions((current) => {
      const value = edit(current.titleRules);
      return { titleRules: value.length === 0 ? NO_TITLE_RULES : value };
    });
  };
  // Clears what the menus show. While the enhanced filter is off the saved status, account and
  // title rules are hidden, so they stay for when it is turned on again.
  const resetFilters = () => {
    updateOptions({
      selectedEnvironmentId: null,
      selectedProjectKeys: NO_PROJECT_KEYS,
      ...(enhancedFilterEnabled
        ? { selectedStatuses: NO_STATUSES, selectedAccountKey: null, titleRules: NO_TITLE_RULES }
        : {}),
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
    setTitleRules,
    resetFilters,
    setProjectSortOrder,
  } as const;
}
