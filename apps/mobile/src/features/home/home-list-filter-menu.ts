import type { MenuAction } from "@react-native-menu/menu";
import {
  THREAD_FILTER_STATUS_OPTIONS,
  UNAVAILABLE_ACCOUNT_LABEL,
  threadFilterStatusOption,
  toggleThreadFilterStatus,
  type ThreadFilterStatus,
  type ThreadFilterStatusCounts,
} from "@t3tools/client-runtime/state/thread-filters";
import type { EnvironmentId } from "@t3tools/contracts";

import { toggleProjectKey, type ThreadListAccountOption } from "./thread-list-filters";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
}

/** What the status and account menus need; absent while the enhanced filter is off. */
export interface HomeListFilterMenuEnhanced {
  readonly statuses: ReadonlyArray<ThreadFilterStatus>;
  /** Null until counted; the subtitles are left out then. */
  readonly statusCounts: ThreadFilterStatusCounts | null;
  /** Older settled threads are not loaded, so the Done count is a lower bound. */
  readonly doneHasMore: boolean;
  readonly accountOptions: ReadonlyArray<ThreadListAccountOption>;
  readonly selectedAccountKey: string | null;
}

export interface HomeListFilterMenuState {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  /** Several with the enhanced filter on; at most one without it. */
  readonly selectedProjectKeys: ReadonlyArray<string>;
  readonly enhanced: HomeListFilterMenuEnhanced | null;
  /** The tablet sidebar explains "All environments" and "All projects" even without the enhanced filter. */
  readonly sidebar?: boolean;
}

export interface HomeListFilterMenuHandlers {
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectsChange: (projectKeys: ReadonlyArray<string>) => void;
  readonly onStatusesChange: (statuses: ReadonlyArray<ThreadFilterStatus>) => void;
  readonly onAccountChange: (accountKey: string | null) => void;
}

/** The handlers plus the control that clears the filters the menus show. */
export interface HomeListFilterControls extends HomeListFilterMenuHandlers {
  readonly onReset: () => void;
}

/** Whether any filter narrows the list, which the reset control and the filter icon show. */
export const isHomeListFilterCustomized = (state: HomeListFilterMenuState): boolean =>
  state.selectedEnvironmentId !== null ||
  state.selectedProjectKeys.length > 0 ||
  (state.enhanced !== null &&
    (state.enhanced.statuses.length > 0 || state.enhanced.selectedAccountKey !== null));

export interface HomeListFilterMenuEntry {
  /** Prefixed by its menu: `environment:`, `project:`, `status:` or `account:`. */
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly state?: "on" | "off";
  /** A toggle in a multi-select menu: iOS keeps the menu open for the next tap. */
  readonly keepsMenuPresented?: boolean;
}

/** The id of the menu entry that clears every filter the menus show. */
const HOME_LIST_FILTER_RESET_ID = "reset";
const RESET_TITLE = "Reset filters";

export interface HomeListFilterMenuSection {
  readonly id: "environment" | "project" | "status" | "account";
  readonly title: string;
  readonly entries: ReadonlyArray<HomeListFilterMenuEntry>;
}

const onOff = (on: boolean) => (on ? ("on" as const) : ("off" as const));

function countSubtitle(count: number, more: boolean): string {
  return `${count}${more ? "+" : ""} ${count === 1 && !more ? "thread" : "threads"}`;
}

/** The menus in the order the chips and the submenus list them. */
export function buildHomeListFilterSections(
  state: HomeListFilterMenuState,
): ReadonlyArray<HomeListFilterMenuSection> {
  const { enhanced } = state;
  const explainAll = enhanced !== null || state.sidebar === true;
  const sections: HomeListFilterMenuSection[] = [
    {
      id: "environment",
      title: "Environment",
      entries: [
        {
          id: "environment:all",
          title: "All environments",
          ...(explainAll ? { subtitle: "Show threads from every environment" } : {}),
          state: onOff(state.selectedEnvironmentId === null),
        },
        ...state.environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          title: environment.label,
          state: onOff(environment.environmentId === state.selectedEnvironmentId),
        })),
      ],
    },
  ];
  if (state.projects.length > 0) {
    sections.push({
      id: "project",
      title: "Project",
      entries: [
        {
          id: "project:all",
          title: "All projects",
          ...(explainAll ? { subtitle: "Show threads from every project" } : {}),
          state: onOff(state.selectedProjectKeys.length === 0),
        },
        ...state.projects.map((project) => ({
          id: `project:${project.key}`,
          title: project.label,
          state: onOff(state.selectedProjectKeys.includes(project.key)),
          ...(enhanced === null ? {} : { keepsMenuPresented: true }),
        })),
      ],
    });
  }
  if (enhanced === null) return sections;

  sections.push({
    id: "status",
    title: "Status",
    entries: [
      ...THREAD_FILTER_STATUS_OPTIONS.map((option) => {
        const count = enhanced.statusCounts?.[option.value];
        return {
          id: `status:${option.value}`,
          title: option.label,
          ...(count === undefined
            ? {}
            : { subtitle: countSubtitle(count, option.value === "done" && enhanced.doneHasMore) }),
          state: onOff(enhanced.statuses.includes(option.value)),
          keepsMenuPresented: true,
        };
      }),
      ...(enhanced.statuses.length === 0 ? [] : [{ id: "status:clear", title: "Clear status" }]),
    ],
  });
  const accountMissing =
    enhanced.selectedAccountKey !== null &&
    !enhanced.accountOptions.some((option) => option.key === enhanced.selectedAccountKey);
  if (enhanced.accountOptions.length > 1 || enhanced.selectedAccountKey !== null) {
    sections.push({
      id: "account",
      title: "Account",
      entries: [
        {
          id: "account:all",
          title: "All accounts",
          state: onOff(enhanced.selectedAccountKey === null),
        },
        ...enhanced.accountOptions.map((option) => ({
          id: `account:${option.key}`,
          title: option.label,
          state: onOff(option.key === enhanced.selectedAccountKey),
        })),
        ...(accountMissing && enhanced.selectedAccountKey !== null
          ? [
              {
                id: `account:${enhanced.selectedAccountKey}`,
                title: UNAVAILABLE_ACCOUNT_LABEL,
                state: "on" as const,
              },
            ]
          : []),
      ],
    });
  }
  return sections;
}

/** Runs the entry with this id; an id the menu does not offer does nothing. */
export function applyHomeListFilterAction(
  id: string,
  state: HomeListFilterMenuState,
  handlers: HomeListFilterControls,
): void {
  const { enhanced } = state;
  if (id === HOME_LIST_FILTER_RESET_ID) return handlers.onReset();
  if (id === "environment:all") return handlers.onEnvironmentChange(null);
  if (id.startsWith("environment:")) {
    const environment = state.environments.find(
      (candidate) => String(candidate.environmentId) === id.slice("environment:".length),
    );
    if (environment) handlers.onEnvironmentChange(environment.environmentId);
    return;
  }
  if (id === "project:all") return handlers.onProjectsChange([]);
  if (id.startsWith("project:")) {
    const key = id.slice("project:".length);
    if (!state.projects.some((project) => project.key === key)) return;
    // Without the enhanced filter a pick replaces the choice, as it always did.
    handlers.onProjectsChange(
      enhanced === null ? [key] : toggleProjectKey(state.selectedProjectKeys, key),
    );
    return;
  }
  if (enhanced === null) return;
  if (id === "status:clear") return handlers.onStatusesChange([]);
  if (id.startsWith("status:")) {
    const status = THREAD_FILTER_STATUS_OPTIONS.find(
      (option) => option.value === id.slice("status:".length),
    );
    if (status)
      handlers.onStatusesChange(toggleThreadFilterStatus(enhanced.statuses, status.value));
    return;
  }
  if (id === "account:all") return handlers.onAccountChange(null);
  if (id.startsWith("account:")) {
    const key = id.slice("account:".length);
    if (enhanced.accountOptions.some((option) => option.key === key)) handlers.onAccountChange(key);
  }
}

export function homeListFilterMenuActions(
  entries: ReadonlyArray<HomeListFilterMenuEntry>,
): MenuAction[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    ...(entry.subtitle === undefined ? {} : { subtitle: entry.subtitle }),
    ...(entry.state === undefined ? {} : { state: entry.state }),
    ...(entry.keepsMenuPresented ? { attributes: { keepsMenuPresented: true } } : {}),
  }));
}

/**
 * The menus as nested actions, for the Android toolbar menu. `withReset` adds the entry that
 * clears every filter; pass whether any filter is set.
 */
export function homeListFilterSubmenuActions(
  sections: ReadonlyArray<HomeListFilterMenuSection>,
  withReset = false,
): MenuAction[] {
  return [
    ...sections.map((section) => ({
      id: section.id,
      title: section.title,
      subactions: homeListFilterMenuActions(section.entries),
    })),
    ...(withReset ? [{ id: HOME_LIST_FILTER_RESET_ID, title: RESET_TITLE }] : []),
  ];
}

/**
 * The label a chip or filter button shows for the selected statuses. More than
 * one becomes a count, so the chip keeps its width and the row does not push
 * later chips off screen; the accessibility label still names each one.
 */
export function statusFilterLabel(statuses: ReadonlyArray<ThreadFilterStatus>): string {
  if (statuses.length === 0) return "Status";
  const [only] = statuses;
  return statuses.length === 1 && only !== undefined
    ? threadFilterStatusOption(only).label
    : `${statuses.length} statuses`;
}

export function projectFilterLabel(
  projects: ReadonlyArray<HomeListFilterMenuProject>,
  selectedKeys: ReadonlyArray<string>,
): string {
  const selected = projects.filter((project) => selectedKeys.includes(project.key));
  if (selected.length === 0) return "All projects";
  return selected.length === 1 ? selected[0]!.label : `${selected.length} projects`;
}

export function accountFilterLabel(enhanced: HomeListFilterMenuEnhanced): string {
  if (enhanced.selectedAccountKey === null) return "Account";
  return (
    enhanced.accountOptions.find((option) => option.key === enhanced.selectedAccountKey)?.label ??
    UNAVAILABLE_ACCOUNT_LABEL
  );
}

/** What a screen reader says for each chip: the filter and its current selection. */
export function homeListFilterChipAccessibilityLabels(state: HomeListFilterMenuState) {
  const { enhanced } = state;
  const environment =
    state.environments.find((candidate) => candidate.environmentId === state.selectedEnvironmentId)
      ?.label ?? "All environments";
  return {
    environment: `Filter threads by environment, ${environment}`,
    project: `Filter threads by project, ${projectFilterLabel(state.projects, state.selectedProjectKeys)}`,
    status:
      enhanced === null
        ? null
        : `Filter threads by status, ${
            enhanced.statuses.length === 0
              ? "All statuses"
              : enhanced.statuses.map((status) => threadFilterStatusOption(status).label).join(", ")
          }`,
    account:
      enhanced === null
        ? null
        : `Filter threads by account, ${
            enhanced.selectedAccountKey === null ? "All accounts" : accountFilterLabel(enhanced)
          }`,
  };
}

type HomeListFilterMenuAction = {
  readonly type: "action";
  readonly title: string;
  readonly subtitle?: string;
  readonly state?: "on" | "off";
  readonly keepsMenuPresented?: boolean;
  readonly onPress: () => void;
};

type HomeListFilterMenuSubmenu = {
  readonly type: "submenu";
  readonly title: string;
  readonly items: HomeListFilterMenuAction[];
};

export interface HomeListFilterMenu {
  readonly title: string;
  readonly items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu>;
}

/** The menus as native header items, for the iOS sidebar. */
export function buildHomeListFilterMenu(
  state: HomeListFilterMenuState,
  handlers: HomeListFilterControls,
): HomeListFilterMenu {
  return {
    title: "Thread list options",
    items: [
      ...buildHomeListFilterSections(state).map((section) => ({
        type: "submenu" as const,
        title: section.title,
        items: section.entries.map((entry) => ({
          type: "action" as const,
          title: entry.title,
          ...(entry.subtitle === undefined ? {} : { subtitle: entry.subtitle }),
          ...(entry.state === undefined ? {} : { state: entry.state }),
          ...(entry.keepsMenuPresented ? { keepsMenuPresented: true } : {}),
          onPress: () => applyHomeListFilterAction(entry.id, state, handlers),
        })),
      })),
      ...(isHomeListFilterCustomized(state)
        ? [{ type: "action" as const, title: RESET_TITLE, onPress: handlers.onReset }]
        : []),
    ],
  };
}
