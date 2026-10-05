import { FolderPlusIcon, ListFilterIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";
import {
  SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL,
  isSidebarTitleFilterActive,
  sidebarThreadFilterButtonLabel,
  type SidebarTitleFilter,
} from "../Sidebar.logic";
import { Button } from "../ui/button";
import { InputGroup, InputGroupInput } from "../ui/input-group";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  searchFieldRef?: RefObject<HTMLDivElement | null>;
  hasProjects: boolean;
  projectScope: ReactNode;
  titleFilter: SidebarTitleFilter;
  /** Takes an updater so a delayed text save never overwrites a newer mode. */
  onTitleFilterChange: (update: (current: SidebarTitleFilter) => SidebarTitleFilter) => void;
  accountOptions: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  selectedAccountKey: string | null;
  onAccountChange: (key: string | null) => void;
  onNewProject: () => void;
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  showNewThreadInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

const TITLE_FILTER_SAVE_DELAY_MS = 150;

/**
 * Keeps the title field's text local and saves it after a short pause. Saving
 * re-renders the whole sidebar, so doing it per keystroke would make typing
 * lag on large thread lists. A change that did not come from this field (Clear
 * filters, another tab) replaces the draft.
 */
function useDebouncedTitleText(
  savedText: string,
  save: (text: string) => void,
): [string, (text: string) => void] {
  const [draft, setDraft] = useState(savedText);
  const lastSavedRef = useRef(savedText);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (savedText === lastSavedRef.current) return;
    lastSavedRef.current = savedText;
    setDraft(savedText);
  }, [savedText]);
  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    const id = window.setTimeout(() => {
      lastSavedRef.current = draft;
      saveRef.current(draft);
    }, TITLE_FILTER_SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [draft]);
  // Unmounting inside the pause would otherwise drop the last keystrokes.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(
    () => () => {
      if (draftRef.current !== lastSavedRef.current) saveRef.current(draftRef.current);
    },
    [],
  );
  return [draft, setDraft];
}

export function SidebarThreadHeader({
  searchFieldRef,
  hasProjects,
  projectScope,
  titleFilter,
  onTitleFilterChange,
  accountOptions,
  selectedAccountKey,
  onAccountChange,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const resultsVisible = isSearching && searchResultCount > 0;
  // Shrinking results can remove the active option; never leave aria-activedescendant pointing at it.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";
  const [titleDraft, setTitleDraft] = useDebouncedTitleText(titleFilter.text, (text) =>
    onTitleFilterChange((current) => ({ ...current, text })),
  );
  const filtersActive = isSidebarTitleFilterActive(titleFilter) || selectedAccountKey !== null;
  const filterButtonLabel = sidebarThreadFilterButtonLabel({
    titleFilter,
    selectedAccountKey,
    accountOptions,
  });

  return (
    <div className="flex items-center gap-1">
      <div
        ref={searchFieldRef}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground redesign:focus-within:bg-sidebar-row-hover redesign:focus-within:text-sidebar-foreground redesign:focus-within:ring-1 redesign:focus-within:ring-inset redesign:focus-within:ring-ring/70"
      >
        <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search"
          aria-label="Search threads"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={resultsVisible}
          aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
          aria-activedescendant={
            activeResultExists
              ? `sidebar-thread-search-result-${activeSearchResultIndex}`
              : undefined
          }
          className="min-w-0 flex-1"
        />
        {isSearching ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label="Clear thread search"
            onClick={() => {
              onClearSearch();
              searchInputRef.current?.focus();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">
        <Menu>
          <MenuTrigger render={<SidebarHeaderIconButton label={filterButtonLabel} />}>
            <ListFilterIcon className={cn("size-4", filtersActive && "text-sidebar-foreground")} />
            {filtersActive ? (
              <span
                aria-hidden
                className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
              />
            ) : null}
          </MenuTrigger>
          <MenuPopup
            align="end"
            side="bottom"
            // Account names are user-chosen and can be long. Without a cap the
            // menu grows past the sidebar and over the conversation; the cap is
            // what makes the labels below truncate.
            className="max-w-[min(18rem,var(--available-width))] overflow-hidden"
          >
            <MenuRadioGroup
              value={titleFilter.mode}
              onValueChange={(mode) =>
                onTitleFilterChange((current) => ({
                  ...current,
                  mode: mode === "include" ? "include" : "exclude",
                }))
              }
            >
              <MenuGroupLabel>Title</MenuGroupLabel>
              <div className="px-1 pb-1">
                <InputGroup>
                  <InputGroupInput
                    autoFocus
                    size="compact"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.currentTarget.value)}
                    // The menu's typeahead would otherwise take these keys.
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "Escape") {
                        event.stopPropagation();
                      }
                    }}
                    placeholder="Title contains"
                    aria-label="Title contains"
                  />
                </InputGroup>
              </div>
              <MenuRadioItem value="exclude">
                <span className="flex items-center gap-2">
                  Exclude matches
                  <MenuRadioItemIndicator className="ms-auto" />
                </span>
              </MenuRadioItem>
              <MenuRadioItem value="include">
                <span className="flex items-center gap-2">
                  Only show matches
                  <MenuRadioItemIndicator className="ms-auto" />
                </span>
              </MenuRadioItem>
            </MenuRadioGroup>
            <MenuSeparator />
            <MenuRadioGroup
              value={selectedAccountKey ?? ""}
              onValueChange={(value) => onAccountChange(value || null)}
            >
              <MenuGroupLabel>Account</MenuGroupLabel>
              <MenuRadioItem value="">
                <span className="flex items-center gap-2">
                  All accounts
                  <MenuRadioItemIndicator className="ms-auto" />
                </span>
              </MenuRadioItem>
              {accountOptions.map((option) => (
                <MenuRadioItem key={option.key} value={option.key}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))}
              {selectedAccountKey !== null &&
              !accountOptions.some((option) => option.key === selectedAccountKey) ? (
                <MenuRadioItem value={selectedAccountKey} disabled>
                  <span className="flex items-center gap-2">
                    {SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL}
                    <MenuRadioItemIndicator className="ms-auto" />
                  </span>
                </MenuRadioItem>
              ) : null}
            </MenuRadioGroup>
            {filtersActive ? (
              <>
                <MenuSeparator />
                <MenuItem
                  onClick={() => {
                    setTitleDraft("");
                    onTitleFilterChange((current) => ({ ...current, text: "" }));
                    onAccountChange(null);
                  }}
                >
                  Clear filters
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
        {hasProjects ? (
          <>
            {projectScope}
            <SidebarHeaderIconButton label="Add project" onClick={onNewProject}>
              <FolderPlusIcon />
            </SidebarHeaderIconButton>
          </>
        ) : null}
        <SidebarHeaderIconButton
          label="New thread"
          tooltip={
            showNewThreadInProjectHint ? (
              <span className="flex flex-col gap-0.5">
                <span>{newThreadLabel}</span>
                <span className="text-muted-foreground">
                  New thread in current project: Shift+click
                  {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
                </span>
              </span>
            ) : (
              newThreadLabel
            )
          }
          disabled={newThreadDisabled}
          onClick={onNewThread}
        >
          <SquarePenIcon />
        </SidebarHeaderIconButton>
      </div>
    </div>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn("relative size-7 shrink-0", className)}
          />
        }
      >
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
