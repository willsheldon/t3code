import { uuidv4 } from "../../lib/uuid";
import { ThreadUndoNotice } from "./ThreadUndoNotice";
import { Toolbar } from "../../components/ui/Toolbar";
import { use } from "react";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Platform, useWindowDimensions } from "react-native";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { NativeStackScreenOptions } from "../../native/StackHeader";
import { usePendingNewTasks } from "../../state/use-pending-new-tasks";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useDeviceType, useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { WorkspaceEmptyDetail } from "../layout/WorkspaceEmptyDetail";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { AndroidHomeFabLayout } from "./AndroidHomeFab";
import { HomeScreen } from "./HomeScreen";
import { HomeHeader } from "./HomeHeader";
import { useHomeRouteVisible } from "./home-route-visibility";
import { useThreadListFilterModel } from "./use-thread-list-filter-model";
import { usePendingTaskListActions } from "./usePendingTaskListActions";
import { useThreadListActions } from "./useThreadListActions";
import { getConnectionAwareBrandHeaderOptions } from "./WorkspaceConnectionTitle";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { openSettings } from "../settings/settings-navigation";
import { useSelectWorkspaceTab } from "../workspace/useSelectWorkspaceTab";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";

export function HomeRouteScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const nativePrimaryColumn = use(NativePrimaryColumnContext);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const deviceType = useDeviceType();
  const headerWidth = nativePrimaryColumn ? (columnMetrics?.width ?? windowWidth) : windowWidth;
  const { layout, panes, primarySidebarSearchQuery, setPrimarySidebarSearchQuery, startNewTask } =
    useAdaptiveWorkspaceLayout();
  const selectDetail = useSelectWorkspaceDetail();
  // Stop rebuilding the streaming thread list while Thread covers Home.
  const visible = useHomeRouteVisible();
  // The split view without the native primary column shows no filter menu: the sidebar owns it.
  const showsSplitDetailOnly = layout.usesSplitView && !nativePrimaryColumn;
  const {
    projects,
    threads,
    catalogState,
    savedConnectionsById,
    environments,
    listOptions,
    selectedEnvironmentId,
    filterState,
    filterControls,
  } = useThreadListFilterModel({
    visible,
    menus: Platform.OS !== "ios" && !showsSplitDetailOnly,
  });
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const workspace = useWorkspaceTabs();
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const searchQuery =
    Platform.OS === "android"
      ? primarySidebarSearchQuery
      : (workspace?.state.tabs.threads.query ?? localSearchQuery);
  const setSearchQuery = (query: string) => {
    if (Platform.OS === "android") setPrimarySidebarSearchQuery(query);
    else if (workspace) workspace.dispatch({ type: "query", query, tab: "threads" });
    else setLocalSearchQuery(query);
  };
  const handleSelectThread = (thread: EnvironmentThreadShell) =>
    selectDetail({
      name: "Thread",
      params: { environmentId: String(thread.environmentId), threadId: String(thread.id) },
    });
  const selectThreadRoute = (params: ReactNavigation.RootParamList["Thread"]) =>
    selectDetail({ name: "Thread", params });
  const handleNewThreadOnBranch = (thread: EnvironmentThreadShell) => {
    selectThreadRoute({
      draft: {
        requestId: uuidv4(),
        environmentId: String(thread.environmentId),
        projectId: String(thread.projectId),
        branch: thread.branch,
        worktreePath: thread.worktreePath,
      },
    });
  };

  const {
    archiveThread,
    confirmDeleteThread,
    settleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    setThreadAutoSettle,
    moveThread,
    renameThread,
    regenerateThreadTitle,
    unsettleThread,
  } = useThreadListActions();
  const pendingTasks = usePendingNewTasks();
  const { openPendingTask, confirmDeletePendingTask } =
    usePendingTaskListActions(selectThreadRoute);
  if (showsSplitDetailOnly) {
    return (
      <>
        <NativeStackScreenOptions
          options={
            Platform.OS === "android"
              ? { headerShown: false }
              : {
                  title: "",
                  headerTitle: "",
                  unstable_headerLeftItems: () => [],
                  headerSearchBarOptions: undefined,
                  unstable_headerRightItems: () => [],
                  unstable_headerToolbarItems: () => [],
                }
          }
        />
        {Platform.OS === "ios" ? (
          <Toolbar placement="left">
            <Toolbar.Button
              accessibilityLabel="New task"
              icon="square.and.pencil"
              onPress={startNewTask}
            />
          </Toolbar>
        ) : null}
        {Platform.OS === "android" ? <AndroidScreenHeader title="Threads" /> : null}
        <WorkspaceEmptyDetail
          onAddConnection={
            Platform.OS === "android" && !catalogState.hasConnections
              ? () => openSettings(navigation, "SettingsEnvironmentNew")
              : undefined
          }
          onStartNewTask={
            Platform.OS === "android" && panes.primarySidebarVisible ? undefined : startNewTask
          }
        />
      </>
    );
  }

  return (
    <AndroidHomeFabLayout
      disabled={workspace !== null && Platform.OS !== "android"}
      onStartNewTask={startNewTask}
    >
      <>
        {/* Screen options merge shallowly; restore the header after split view. */}
        {workspace !== null && Platform.OS === "ios" ? null : (
          <NativeStackScreenOptions
            optionsVersion={headerWidth}
            options={{
              ...getConnectionAwareBrandHeaderOptions({
                headerWidth,
                trailingItemCount: nativePrimaryColumn && deviceType === "pad" ? 2 : 1,
                onOpenEnvironments: () => openSettings(navigation, "SettingsEnvironments"),
              }),
              headerShown: Platform.OS !== "android",
            }}
          />
        )}
        <HomeHeader
          filterState={filterState}
          filterControls={filterControls}
          searchQuery={searchQuery}
          onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
          onOpenSettings={() => selectTab("settings")}
          onSearchQueryChange={setSearchQuery}
          onStartNewTask={startNewTask}
        />

        <HomeScreen
          catalogState={catalogState}
          environments={environments}
          onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
          onArchiveThread={archiveThread}
          onDeleteThread={confirmDeleteThread}
          onSettleThread={settleThread}
          onSnoozeThread={snoozeThread}
          onUnsnoozeThread={unsnoozeThread}
          onUnsettleThread={unsettleThread}
          onPinThread={pinThread}
          onUnpinThread={unpinThread}
          onSetThreadAutoSettle={setThreadAutoSettle}
          onMoveThread={moveThread}
          onRenameThread={renameThread}
          onRegenerateThreadTitle={regenerateThreadTitle}
          onOpenSettings={() => selectTab("settings")}
          onSearchQueryChange={setSearchQuery}
          onSelectThread={handleSelectThread}
          onSelectPendingTask={openPendingTask}
          onDeletePendingTask={confirmDeletePendingTask}
          onNewThreadOnBranch={handleNewThreadOnBranch}
          onNewThreadInProject={(project) => {
            selectThreadRoute({
              draft: {
                requestId: uuidv4(),
                environmentId: String(project.environmentId),
                projectId: String(project.id),
                title: project.title,
              },
            });
          }}
          onStartNewTask={startNewTask}
          pendingTasks={pendingTasks}
          listOptions={listOptions}
          projects={projects}
          savedConnectionsById={savedConnectionsById}
          searchQuery={searchQuery}
          selectedEnvironmentId={selectedEnvironmentId}
          filterState={filterState}
          filterControls={filterControls}
          threads={threads}
        />
        <ThreadUndoNotice visible={visible} />
      </>
    </AndroidHomeFabLayout>
  );
}
