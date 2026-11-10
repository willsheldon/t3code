import type {
  HomeListFilterControls,
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuState,
} from "./home-list-filter-menu";

export type HomeHeaderEnvironment = HomeListFilterMenuEnvironment;

export interface HomeHeaderProps {
  readonly filterState: HomeListFilterMenuState;
  readonly filterControls: HomeListFilterControls;
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onOpenEnvironments: () => void;
  readonly onOpenSettings: () => void;
  readonly onStartNewTask: () => void;
}
