import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useMemo } from "react";

import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";

import { useProjects } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { useLaunchingThreads } from "../../state/use-pending-new-tasks";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useWorkspaceState } from "../../state/workspace";
import { useAtomValueWhileVisible } from "./home-route-visibility";
import type { HomeListFilterControls, HomeListFilterMenuState } from "./home-list-filter-menu";
import { useHomeListOptions } from "./home-list-options";
import { buildHomeProjectScopes } from "./homeThreadList";
import { resolveProjectFilter } from "./thread-list-filters";
import { useEnhancedThreadFilterMenu } from "./use-thread-list-filter-menu";

/**
 * The thread list's filter choices without the thread walk: what the header button needs to
 * show how many are set, and the base of the full model.
 */
export function useThreadListFilterSelection() {
  const projects = useProjects();
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const connectionStateByEnvironmentId = new Map(
    workspaceEnvironments.map(
      (environment) => [environment.environmentId, environment.connectionState] as const,
    ),
  );
  const environments = Arr.sort(
    Object.values(savedConnectionsById).map((connection) => ({
      environmentId: connection.environmentId,
      label: connection.environmentLabel,
      connectionState: connectionStateByEnvironmentId.get(connection.environmentId) ?? "available",
    })),
    Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
  );
  const availableEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const {
    options: listOptions,
    setSelectedEnvironmentId,
    setSelectedProjectKeys,
    setSelectedStatuses,
    setSelectedAccountKey,
    setTitleRules,
    resetFilters,
  } = useHomeListOptions(availableEnvironmentIds);
  const selectedEnvironmentId = listOptions.selectedEnvironmentId;
  const projectScopes = useMemo(
    () =>
      pickableProjectGroups(
        buildHomeProjectScopes({
          projects,
          environmentId: selectedEnvironmentId,
          projectGroupingMode: listOptions.projectGroupingMode,
        }),
      ),
    [listOptions.projectGroupingMode, projects, selectedEnvironmentId],
  );
  const projectFilterOptions = useMemo(
    () => projectScopes.map((scope) => ({ key: scope.key, label: scope.title })),
    [projectScopes],
  );
  // A legacy per-environment scratch key resolves here on every render; the stored
  // value is only rewritten when the user picks a filter.
  const projectFilter = useMemo(
    () =>
      resolveProjectFilter({
        keys: listOptions.selectedProjectKeys,
        projects,
        scopes: projectScopes,
        projectGroupingMode: listOptions.projectGroupingMode,
      }),
    [listOptions.projectGroupingMode, listOptions.selectedProjectKeys, projectScopes, projects],
  );
  const filterControls: HomeListFilterControls = {
    onEnvironmentChange: setSelectedEnvironmentId,
    onProjectsChange: setSelectedProjectKeys,
    onStatusesChange: setSelectedStatuses,
    onAccountChange: setSelectedAccountKey,
    onTitleRulesChange: setTitleRules,
    onReset: resetFilters,
  };
  return {
    projects,
    catalogState,
    savedConnectionsById,
    environments,
    listOptions,
    selectedEnvironmentId,
    projectFilter,
    projectFilterOptions,
    filterControls,
  };
}

/**
 * The filter menus' state and handlers, shared by the thread list and the iOS filter sheet.
 * `visible` stops reading the thread list while Home sits under a pushed Thread. Pass
 * `menus: false` where the menus are not shown (the split view without a primary column).
 */
export function useThreadListFilterModel(input: {
  readonly visible: boolean;
  readonly menus: boolean;
}) {
  const selection = useThreadListFilterSelection();
  const { listOptions, environments, selectedEnvironmentId, projectFilter } = selection;
  const threads = useLaunchingThreads(
    useAtomValueWhileVisible(environmentThreadShells.navigationThreadShellsAtom, input.visible),
  );
  const enhancedFilter = useEnhancedThreadFilterMenu({
    enabled: listOptions.enhancedFilterEnabled && input.menus,
    visible: input.visible,
    threads,
    environments,
    environmentId: selectedEnvironmentId,
    projectRefs: projectFilter.projectRefs,
    statuses: listOptions.selectedStatuses,
    accountKey: listOptions.selectedAccountKey,
    rules: listOptions.titleRules,
  });
  const filterState: HomeListFilterMenuState = {
    environments,
    selectedEnvironmentId,
    projects: selection.projectFilterOptions,
    selectedProjectKeys: projectFilter.keys,
    enhanced: enhancedFilter,
  };
  return { ...selection, threads, filterState };
}
