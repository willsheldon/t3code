import { NativeStackScreenOptions } from "../../native/StackHeader";
import { ThreadListToolbar } from "./ThreadListToolbar";
import type { HomeHeaderProps } from "./HomeHeader.types";
import {
  applyHomeListFilterAction,
  buildHomeListFilterSections,
  homeListFilterSubmenuActions,
  isHomeListFilterCustomized,
} from "./home-list-filter-menu";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

export function HomeHeader(props: HomeHeaderProps) {
  const filterCustomized = isHomeListFilterCustomized(props.filterState);
  const menuActions = homeListFilterSubmenuActions(
    buildHomeListFilterSections(props.filterState),
    filterCustomized,
    props.filterState.enhanced !== null && props.filterControls.onOpenRules !== undefined,
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <ThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterActions={menuActions}
        filterCustomized={filterCustomized}
        onFilterAction={({ nativeEvent }) =>
          applyHomeListFilterAction(nativeEvent.event, props.filterState, props.filterControls)
        }
        onOpenEnvironments={props.onOpenEnvironments}
      />
    </>
  );
}
