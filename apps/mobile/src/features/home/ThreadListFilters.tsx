import { Pressable, View } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import {
  applyHomeListFilterAction,
  buildHomeListFilterSections,
  homeListFilterChipAccessibilityLabels,
  homeListFilterMenuActions,
  isHomeListFilterCustomized,
  projectFilterLabel,
  type HomeListFilterControls,
  type HomeListFilterMenuState,
} from "./home-list-filter-menu";

/**
 * The chip row under the search field while the enhanced filter is off: the environment and
 * project chips and the reset. With it on, the header's filter button opens the filter sheet.
 */
export function ThreadListFilters(props: {
  readonly filterState: HomeListFilterMenuState;
  readonly filterControls: HomeListFilterControls;
  /** List padding the scroller bleeds through so pills start where row content does. */
  readonly gutter: number;
}) {
  const { filterState, filterControls } = props;
  const selectedEnvironment = filterState.environments.find(
    (environment) => environment.environmentId === filterState.selectedEnvironmentId,
  );
  const sections = buildHomeListFilterSections(filterState);
  const labels = homeListFilterChipAccessibilityLabels(filterState);
  const chip = (id: "environment" | "project") => {
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
  // The row wraps instead of scrolling, so both chips and the reset stay fully visible
  // however long the labels get.
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
