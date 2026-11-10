import { Pressable, View } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListFilterMenu } from "../workspace/ListFilterMenu";
import {
  accountFilterLabel,
  applyHomeListFilterAction,
  buildHomeListFilterSections,
  homeListFilterChipAccessibilityLabels,
  homeListFilterMenuActions,
  isHomeListFilterCustomized,
  projectFilterLabel,
  statusFilterLabel,
} from "./home-list-filter-menu";
import type { HomeHeaderProps } from "./HomeHeader.types";

export function ThreadListFilters(
  props: Pick<HomeHeaderProps, "filterState" | "filterControls"> & {
    /** List padding the scroller bleeds through so pills start where row content does. */
    readonly gutter: number;
  },
) {
  const { filterState, filterControls } = props;
  const { enhanced } = filterState;
  const selectedEnvironment = filterState.environments.find(
    (environment) => environment.environmentId === filterState.selectedEnvironmentId,
  );
  const sections = buildHomeListFilterSections(filterState);
  const labels = homeListFilterChipAccessibilityLabels(filterState);
  const chip = (id: "environment" | "project" | "status" | "account") => {
    const section = sections.find((candidate) => candidate.id === id);
    return section === undefined
      ? null
      : {
          actions: homeListFilterMenuActions(section.entries),
          onSelect: (entryId: string) =>
            applyHomeListFilterAction(entryId, filterState, filterControls),
        };
  };
  const environmentChip = chip("environment");
  const projectChip = chip("project");
  const statusChip = chip("status");
  const accountChip = chip("account");
  // Status leads because it changes most. The row wraps instead of scrolling,
  // so every chip and the reset stay fully visible however long the labels get.
  return (
    <View
      className="flex-row flex-wrap items-center"
      style={{
        marginHorizontal: -props.gutter,
        paddingHorizontal: 20,
        paddingTop: 2,
        paddingBottom: 10,
        gap: 8,
      }}
    >
      {statusChip === null || enhanced === null ? null : (
        <ListFilterMenu
          label={statusFilterLabel(enhanced.statuses)}
          title="Filter threads by status"
          accessibilityLabel={labels.status ?? "Filter threads by status"}
          active={enhanced.statuses.length > 0}
          {...statusChip}
        />
      )}
      {environmentChip === null ? null : (
        <ListFilterMenu
          label={selectedEnvironment?.label ?? "All environments"}
          title="Filter threads by environment"
          accessibilityLabel={labels.environment}
          active={selectedEnvironment !== undefined}
          {...environmentChip}
        />
      )}
      {projectChip === null ? null : (
        <ListFilterMenu
          label={projectFilterLabel(filterState.projects, filterState.selectedProjectKeys)}
          title="Filter threads by project"
          accessibilityLabel={labels.project}
          active={filterState.selectedProjectKeys.length > 0}
          {...projectChip}
        />
      )}
      {accountChip === null || enhanced === null ? null : (
        <ListFilterMenu
          label={accountFilterLabel(enhanced)}
          title="Filter threads by account"
          accessibilityLabel={labels.account ?? "Filter threads by account"}
          active={enhanced.selectedAccountKey !== null}
          {...accountChip}
        />
      )}
      {isHomeListFilterCustomized(filterState) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset thread filters"
          hitSlop={6}
          className="h-8 w-8 items-center justify-center"
          onPress={filterControls.onReset}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      ) : null}
    </View>
  );
}
