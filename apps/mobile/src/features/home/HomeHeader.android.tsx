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
  const menuActions = homeListFilterSubmenuActions(buildHomeListFilterSections(props.filterState));

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <ThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterActions={menuActions}
        filterCustomized={isHomeListFilterCustomized(props.filterState)}
        onFilterAction={({ nativeEvent }) =>
          applyHomeListFilterAction(nativeEvent.event, props.filterState, props.filterControls)
        }
        onOpenEnvironments={props.onOpenEnvironments}
      />
    </>
  );
}
