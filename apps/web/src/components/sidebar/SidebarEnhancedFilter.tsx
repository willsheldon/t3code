/**
 * The enhanced thread filter: a header button whose popover edits status,
 * projects, the account and title rules, and a chip row under the search field that keeps active
 * filters visible and one click from off. State lives in the sidebar; this file
 * only renders it through the helpers in `enhancedFilter.ts`.
 */
import { CheckIcon, PlusIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn, randomUUID } from "~/lib/utils";
import { SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Toggle } from "../ui/toggle";
import { Toggle as ToggleGroupItem, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type CompiledSidebarTitleRules,
  SIDEBAR_STATUS_OPTIONS,
  SIDEBAR_TITLE_RULE_LIMIT,
  type SidebarStatusCounts,
  type SidebarStatusFilter,
  type SidebarTitleRule,
  filterSidebarProjectOptions,
  hasSidebarEnhancedFilterContent,
  insertSidebarTitleRule,
  newSidebarTitleRule,
  removeSidebarTitleRule,
  setSidebarTitleRuleEnabled,
  setSidebarTitleRulePattern,
  sidebarEnhancedFilterBadgeCount,
  sidebarEnhancedFilterButtonLabel,
  sidebarStatusOption,
  sidebarTitleRuleFocusAfterRemoval,
  sidebarTitleRuleText,
  updateSidebarTitleRule,
} from "./enhancedFilter";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

type AccountOption = { readonly key: string; readonly label: string };
type ProjectOption = { readonly key: string; readonly label: string };
type RulesUpdate = (rules: ReadonlyArray<SidebarTitleRule>) => ReadonlyArray<SidebarTitleRule>;

const PATTERN_SAVE_DELAY_MS = 150;
const MAX_CHIPS = 6;
const PROJECT_SEARCH_THRESHOLD = 8;
const sectionClass = "flex flex-col gap-1.5 px-3 py-2.5";

function FilterSectionHeader({
  title,
  id,
  count = 0,
  action,
}: {
  title: string;
  id?: string;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-5 items-center gap-1.5">
      <h3 id={id} className="text-2xs font-medium text-muted-foreground">
        {title}
      </h3>
      {count > 0 ? (
        <span className="text-2xs tabular-nums text-muted-foreground/70">{count}</span>
      ) : null}
      {action ? <div className="ms-auto">{action}</div> : null}
    </div>
  );
}

function SectionClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" size="micro" variant="ghost-muted" aria-label={label} onClick={onClick}>
      Clear
    </Button>
  );
}

/**
 * Keeps a pattern field's text local and saves it after a short pause. Saving
 * re-renders the whole sidebar, so doing it per keystroke would make typing lag
 * on large thread lists. A change that did not come from this field (Clear all,
 * another tab) replaces the draft.
 */
function useDebouncedPattern(
  savedText: string,
  save: (text: string) => void,
): [string, (text: string) => void] {
  const [draft, setDraft] = useState(savedText);
  const lastSavedRef = useRef(savedText);
  const saveRef = useRef(save);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize the save callback used by the pending timer and unmount cleanup.
  useEffect(() => {
    saveRef.current = save;
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Replace the draft when persistent storage changes outside this field.
  useEffect(() => {
    if (savedText === lastSavedRef.current) return;
    lastSavedRef.current = savedText;
    setDraft(savedText);
  }, [savedText]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Debounce persistent writes without filtering the whole sidebar per keystroke.
  useEffect(() => {
    if (draft === lastSavedRef.current) return;
    const id = window.setTimeout(() => {
      lastSavedRef.current = draft;
      saveRef.current(draft);
    }, PATTERN_SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [draft]);
  // Unmounting inside the pause would otherwise drop the last keystrokes. The
  // save is id-keyed, so it does nothing for a rule that was just removed.
  const draftRef = useRef(draft);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the latest draft for unmount cleanup.
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Flush pending edits when the popover unmounts.
  useEffect(
    () => () => {
      if (draftRef.current !== lastSavedRef.current) saveRef.current(draftRef.current);
    },
    [],
  );
  return [draft, setDraft];
}

const isComposing = (event: ReactKeyboardEvent) =>
  event.nativeEvent.isComposing || event.keyCode === 229;

function TitleRuleRow({
  rule,
  number,
  error,
  canInsert,
  inputRef,
  onRulesChange,
  onInsertAfter,
  onRemove,
}: {
  rule: SidebarTitleRule;
  number: number;
  error: string | undefined;
  canInsert: boolean;
  inputRef: (element: HTMLInputElement | null) => void;
  onRulesChange: (update: RulesUpdate) => void;
  onInsertAfter: () => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useDebouncedPattern(rule.pattern, (pattern) =>
    onRulesChange((rules) => setSidebarTitleRulePattern(rules, rule.id, pattern)),
  );
  const errorId = `sidebar-filter-rule-${rule.id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Switch
          size="sm"
          checked={rule.enabled}
          onCheckedChange={(checked) =>
            onRulesChange((rules) => setSidebarTitleRuleEnabled(rules, rule.id, Boolean(checked)))
          }
          aria-label={`Rule ${number} enabled`}
        />
        <ToggleGroup
          aria-label={`Rule ${number} mode`}
          className="shrink-0"
          variant="segmented"
          value={[rule.mode]}
          onValueChange={(value) => {
            const next = value[0];
            // Clicking the pressed segment reports an empty value; mode stays set.
            if (next !== "hide" && next !== "only") return;
            onRulesChange((rules) => updateSidebarTitleRule(rules, rule.id, { mode: next }));
          }}
        >
          <ToggleGroupItem value="hide" aria-label={`Rule ${number}: hide matches`}>
            Hide
          </ToggleGroupItem>
          <ToggleGroupItem value="only" aria-label={`Rule ${number}: only show matches`}>
            Only
          </ToggleGroupItem>
        </ToggleGroup>
        <InputGroup className="min-w-0 flex-1">
          <InputGroupInput
            ref={inputRef}
            size="compact"
            value={draft}
            spellCheck={false}
            placeholder={rule.regex ? "Regular expression" : "Title contains"}
            aria-label={`Rule ${number} pattern`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (isComposing(event)) return;
              if (event.key === "Enter") {
                event.preventDefault();
                if (canInsert) onInsertAfter();
              } else if (event.key === "Backspace" && draft === "") {
                event.preventDefault();
                onRemove();
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    size="xs"
                    pressed={rule.regex}
                    onPressedChange={(pressed) =>
                      onRulesChange((rules) =>
                        updateSidebarTitleRule(rules, rule.id, { regex: pressed, tripped: false }),
                      )
                    }
                    aria-label={`Rule ${number} use regular expression`}
                  />
                }
              >
                <span className="font-mono">.*</span>
              </TooltipTrigger>
              <TooltipPopup side="top">Use regular expression</TooltipPopup>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`Remove rule ${number}`}
          onClick={onRemove}
        >
          <XIcon className="size-3" />
        </Button>
      </div>
      {error ? (
        <p id={errorId} className="ps-9 text-2xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Multi-select thread status: a thread shows when it is in any selected status. */
export function StatusFilterSection({
  selected,
  counts,
  doneHasMore,
  onToggle,
  onClear,
  firstOptionRef,
}: {
  selected: ReadonlyArray<SidebarStatusFilter>;
  /** Null until the popover needs them; counting walks every thread. */
  counts: SidebarStatusCounts | null;
  /** Older settled threads are not loaded, so the Done count is a lower bound. */
  doneHasMore: boolean;
  onToggle: (status: SidebarStatusFilter) => void;
  onClear: () => void;
  firstOptionRef?: (element: HTMLButtonElement | null) => void;
}) {
  return (
    <section className={sectionClass} aria-label="Status">
      <FilterSectionHeader
        title="Status"
        count={selected.length}
        action={
          selected.length > 0 ? (
            <SectionClearButton label="Clear status filters" onClick={onClear} />
          ) : null
        }
      />
      <div role="group" aria-label="Status" className="grid grid-cols-2 gap-1">
        {SIDEBAR_STATUS_OPTIONS.map((option, index) => {
          const isSelected = selected.includes(option.value);
          const count = counts?.[option.value];
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger
                render={
                  <button
                    ref={index === 0 ? firstOptionRef : undefined}
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    className={cn(
                      "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-input px-2 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:h-9",
                      isSelected && "border-primary/50 bg-primary/10 font-medium",
                    )}
                    onClick={() => onToggle(option.value)}
                  />
                }
              >
                <span aria-hidden className="flex size-3 shrink-0 items-center justify-center">
                  {isSelected ? (
                    <CheckIcon className="size-3 text-primary" />
                  ) : (
                    <span className={cn("size-1.5 rounded-full", option.dotClass)} />
                  )}
                </span>
                <span className="truncate">{option.label}</span>
                {count === undefined ? null : (
                  <span className="ms-auto text-2xs font-normal tabular-nums text-muted-foreground">
                    {count}
                    {option.value === "done" && doneHasMore ? "+" : ""}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipPopup side="top">{option.description}</TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </section>
  );
}

/** Checkbox rows for the project scope. Each row toggles on its own, so several can stay on. */
export function ProjectFilterSection({
  options,
  selectedKeys,
  onToggle,
  onClear,
  onRowKeyDown,
  onRowContextMenu,
  renderIcon,
  renderActions,
}: {
  options: ReadonlyArray<ProjectOption>;
  selectedKeys: ReadonlyArray<string>;
  onToggle: (key: string) => void;
  onClear?: () => void;
  onRowKeyDown: (key: string, event: ReactKeyboardEvent<HTMLElement>) => void;
  onRowContextMenu: (key: string, event: ReactMouseEvent<HTMLElement>) => void;
  renderIcon: (key: string) => ReactNode;
  renderActions: (key: string) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  // `data-highlighted` is what reveals an unpinned ProjectPinButton, as a menu item does.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const shortcutKey = hoveredKey ?? focusedKey;
  const shownOptions = filterSidebarProjectOptions(options, query);
  const selectedCount = options.filter((option) => selectedKeys.includes(option.key)).length;
  return (
    <section
      className={sectionClass}
      aria-label="Projects"
      onKeyDown={(event) => {
        if (shortcutKey !== null) onRowKeyDown(shortcutKey, event);
      }}
    >
      <FilterSectionHeader
        title="Projects"
        count={selectedCount}
        action={
          onClear && selectedCount > 0 ? (
            <SectionClearButton label="Clear project filters" onClick={onClear} />
          ) : null
        }
      />
      {options.length > PROJECT_SEARCH_THRESHOLD ? (
        <InputGroup>
          <InputGroupInput
            aria-label="Search projects"
            placeholder="Search projects..."
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </InputGroup>
      ) : null}
      {shownOptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No matching projects.</p>
      ) : (
        <div className="flex max-h-48 flex-col overflow-y-auto">
          {shownOptions.map((option) => {
            const selected = selectedKeys.includes(option.key);
            return (
              <div
                key={option.key}
                data-highlighted={
                  hoveredKey === option.key || focusedKey === option.key ? "" : undefined
                }
                className="flex items-center rounded-md data-highlighted:bg-accent"
                onPointerEnter={() => setHoveredKey(option.key)}
                onPointerLeave={() => setHoveredKey(null)}
                onFocus={() => setFocusedKey(option.key)}
                onBlur={() => setFocusedKey(null)}
                onContextMenu={(event) => onRowContextMenu(option.key, event)}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1 text-left"
                  onClick={() => onToggle(option.key)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-input",
                      selected && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {selected ? <CheckIcon className="size-3" /> : null}
                  </span>
                  {renderIcon(option.key)}
                  <span className="min-w-0 flex-1 truncate text-sm">{option.label}</span>
                </button>
                {renderActions(option.key)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function SidebarEnhancedFilterButton({
  rules,
  compiled,
  onRulesChange,
  accountOptions,
  selectedAccountKey,
  onAccountChange,
  projectOptions,
  selectedProjectKeys,
  selectedProjectNames,
  onProjectToggle,
  onProjectsClear,
  onProjectKeyDown,
  onProjectContextMenu,
  renderProjectIcon,
  renderProjectActions,
  open,
  onOpenChange,
  statuses,
  statusCounts,
  doneHasMore,
  onStatusToggle,
  onStatusesClear,
  hiddenCount,
}: {
  statuses: ReadonlyArray<SidebarStatusFilter>;
  statusCounts: SidebarStatusCounts | null;
  doneHasMore: boolean;
  onStatusToggle: (status: SidebarStatusFilter) => void;
  onStatusesClear: () => void;
  hiddenCount: number;
  rules: ReadonlyArray<SidebarTitleRule>;
  compiled: CompiledSidebarTitleRules;
  onRulesChange: (update: RulesUpdate) => void;
  accountOptions: ReadonlyArray<AccountOption>;
  selectedAccountKey: string | null;
  onAccountChange: (key: string | null) => void;
  projectOptions: ReadonlyArray<ProjectOption>;
  selectedProjectKeys: ReadonlyArray<string>;
  selectedProjectNames: ReadonlyArray<string>;
  onProjectToggle: (key: string) => void;
  onProjectsClear: () => void;
  onProjectKeyDown: (key: string, event: ReactKeyboardEvent<HTMLElement>) => void;
  onProjectContextMenu: (key: string, event: ReactMouseEvent<HTMLElement>) => void;
  renderProjectIcon: (key: string) => ReactNode;
  renderProjectActions: (key: string) => ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const firstStatusRef = useRef<HTMLButtonElement | null>(null);
  // A rule id, "add" for the add button, or null. A ref, not state: the rule
  // change that goes with it already re-renders, and focus follows that commit.
  const pendingFocusRef = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Focus the inserted or adjacent input after its DOM commit.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    const element = target === "add" ? addButtonRef.current : inputs.current.get(target);
    element?.focus();
  });

  const badgeCount = sidebarEnhancedFilterBadgeCount(
    compiled,
    selectedAccountKey,
    selectedProjectNames.length,
    statuses.length,
  );
  const canClear = hasSidebarEnhancedFilterContent(
    rules,
    selectedAccountKey,
    selectedProjectNames.length,
    statuses.length,
  );
  const atLimit = rules.length >= SIDEBAR_TITLE_RULE_LIMIT;
  const accountMissing =
    selectedAccountKey !== null &&
    !accountOptions.some((option) => option.key === selectedAccountKey);
  const accountItems = [
    { value: "", label: "All accounts" },
    ...accountOptions.map((option) => ({ value: option.key, label: option.label })),
    ...(accountMissing && selectedAccountKey !== null
      ? [{ value: selectedAccountKey, label: SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL }]
      : []),
  ];

  const insertAfter = (afterId: string | null) => {
    const id = randomUUID();
    onRulesChange((current) => insertSidebarTitleRule(current, afterId, newSidebarTitleRule(id)));
    pendingFocusRef.current = id;
  };
  const remove = (id: string) => {
    pendingFocusRef.current = sidebarTitleRuleFocusAfterRemoval(rules, id) ?? "add";
    onRulesChange((current) => removeSidebarTitleRule(current, id));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <SidebarHeaderIconButton
            label={sidebarEnhancedFilterButtonLabel({
              rules,
              accountKey: selectedAccountKey,
              accountOptions,
              projectNames: selectedProjectNames,
              statuses,
            })}
          />
        }
      >
        <SlidersHorizontalIcon
          className={cn("size-4", badgeCount > 0 && "text-sidebar-foreground")}
        />
        {badgeCount > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-4xs font-semibold leading-none text-primary-foreground"
          >
            {badgeCount}
          </span>
        ) : null}
      </PopoverTrigger>
      {/* The thread pin shortcut stands down inside this marker; see useThreadLifecycle. */}
      <PopoverPopup
        data-sidebar-enhanced-filter
        align="end"
        side="bottom"
        padding="none"
        className="w-[min(23rem,var(--available-width))]"
        initialFocus={() => firstStatusRef.current}
      >
        <div className="flex max-h-[min(40rem,var(--available-height))] flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <h2 className="text-xs font-medium">Filters</h2>
            {hiddenCount > 0 ? (
              <span className="text-2xs tabular-nums text-muted-foreground">
                {hiddenCount} hidden
              </span>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="ms-auto"
              disabled={!canClear}
              onClick={() => {
                onRulesChange(() => []);
                onAccountChange(null);
                onProjectsClear();
                onStatusesClear();
              }}
            >
              Clear all
            </Button>
          </div>
          <div className="flex min-h-0 flex-col divide-y divide-border/60 overflow-y-auto">
            <StatusFilterSection
              selected={statuses}
              counts={statusCounts}
              doneHasMore={doneHasMore}
              onToggle={onStatusToggle}
              onClear={onStatusesClear}
              firstOptionRef={(element) => {
                firstStatusRef.current = element;
              }}
            />
            {projectOptions.length > 0 ? (
              <ProjectFilterSection
                options={projectOptions}
                selectedKeys={selectedProjectKeys}
                onToggle={onProjectToggle}
                onClear={onProjectsClear}
                onRowKeyDown={onProjectKeyDown}
                onRowContextMenu={onProjectContextMenu}
                renderIcon={renderProjectIcon}
                renderActions={renderProjectActions}
              />
            ) : null}
            {accountOptions.length > 1 || selectedAccountKey !== null ? (
              <section className="flex items-center gap-3 px-3 py-2.5" aria-label="Account">
                <h3 className="shrink-0 text-2xs font-medium text-muted-foreground">Account</h3>
                <div className="min-w-0 flex-1">
                  <Select
                    items={accountItems}
                    value={selectedAccountKey ?? ""}
                    onValueChange={(value) => onAccountChange(value ? String(value) : null)}
                  >
                    <SelectTrigger size="compact" aria-label="Account">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      data-sidebar-enhanced-filter
                      alignItemWithTrigger={false}
                      matchTriggerWidth={false}
                    >
                      {accountItems.map((item) => (
                        <SelectItem
                          key={item.value}
                          value={item.value}
                          disabled={accountMissing && item.value === selectedAccountKey}
                        >
                          <span className="truncate">{item.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>
            ) : null}
            <section className={sectionClass} aria-label="Title rules">
              <FilterSectionHeader
                title="Title rules"
                count={compiled.liveCount}
                action={
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          ref={addButtonRef}
                          type="button"
                          size="micro"
                          variant="ghost-muted"
                          disabled={atLimit}
                          onClick={() => insertAfter(null)}
                        />
                      }
                    >
                      <PlusIcon className="size-3" />
                      Add rule
                    </TooltipTrigger>
                    {atLimit ? (
                      <TooltipPopup side="top">
                        {SIDEBAR_TITLE_RULE_LIMIT} rules maximum
                      </TooltipPopup>
                    ) : null}
                  </Tooltip>
                }
              />
              {rules.length === 0 ? (
                <p className="text-xs text-muted-foreground">Hide or show threads by title.</p>
              ) : (
                rules.map((rule, index) => (
                  <TitleRuleRow
                    key={rule.id}
                    rule={rule}
                    number={index + 1}
                    error={compiled.errors.get(rule.id)}
                    canInsert={!atLimit}
                    inputRef={(element) => {
                      if (element) inputs.current.set(rule.id, element);
                      else inputs.current.delete(rule.id);
                    }}
                    onRulesChange={onRulesChange}
                    onInsertAfter={() => insertAfter(rule.id)}
                    onRemove={() => remove(rule.id)}
                  />
                ))
              )}
            </section>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

const chipClass =
  "flex min-w-0 items-center rounded-md border border-sidebar-border text-2xs text-sidebar-muted-foreground";
const chipButtonClass =
  "min-w-0 cursor-pointer truncate px-1.5 py-0.5 hover:bg-sidebar-row-hover hover:text-sidebar-foreground";

export function SidebarEnhancedFilterChips({
  statuses,
  onStatusToggle,
  rules,
  compiled,
  onRulesChange,
  accountOptions,
  selectedAccountKey,
  onAccountChange,
  projects,
  onProjectToggle,
  renderProjectIcon,
  hiddenCount,
  onOpenFilter,
}: {
  statuses: ReadonlyArray<SidebarStatusFilter>;
  onStatusToggle: (status: SidebarStatusFilter) => void;
  rules: ReadonlyArray<SidebarTitleRule>;
  compiled: CompiledSidebarTitleRules;
  onRulesChange: (update: RulesUpdate) => void;
  accountOptions: ReadonlyArray<AccountOption>;
  selectedAccountKey: string | null;
  onAccountChange: (key: string | null) => void;
  projects: ReadonlyArray<ProjectOption>;
  onProjectToggle: (key: string) => void;
  /** Project chips show this icon in place of the project name; the name stays as label and tooltip. */
  renderProjectIcon: (key: string) => ReactNode;
  hiddenCount: number;
  onOpenFilter: () => void;
}) {
  if (!hasSidebarEnhancedFilterContent(rules, selectedAccountKey, projects.length, statuses.length))
    return null;
  const accountLabel =
    selectedAccountKey === null
      ? null
      : (accountOptions.find((option) => option.key === selectedAccountKey)?.label ??
        SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL);
  const ruleChips = rules
    .map((rule, index) => ({ rule, number: index + 1 }))
    .filter(({ rule }) => rule.pattern.trim() !== "");
  const chipSlots = Math.max(0, MAX_CHIPS - statuses.length - (accountLabel === null ? 0 : 1));
  const shownProjects = projects.slice(0, chipSlots);
  const shownRules = ruleChips.slice(0, chipSlots - shownProjects.length);
  const moreCount = projects.length + ruleChips.length - shownProjects.length - shownRules.length;

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5" aria-label="Active filters">
      {statuses.map((status) => {
        const option = sidebarStatusOption(status);
        return (
          <span key={status} className={chipClass}>
            <button
              type="button"
              className={cn(chipButtonClass, "flex items-center gap-1")}
              onClick={onOpenFilter}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", option.dotClass)} />
              {option.label}
            </button>
            <button
              type="button"
              aria-label={`Remove status filter ${option.label}`}
              className="cursor-pointer px-1 py-0.5 hover:text-sidebar-foreground"
              onClick={() => onStatusToggle(status)}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        );
      })}
      {shownProjects.map((project) => (
        <span key={project.key} className={chipClass}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={project.label}
                  className={cn(chipButtonClass, "flex items-center")}
                  onClick={onOpenFilter}
                />
              }
            >
              {renderProjectIcon(project.key) ?? project.label}
            </TooltipTrigger>
            <TooltipPopup side="top">{project.label}</TooltipPopup>
          </Tooltip>
          <button
            type="button"
            aria-label={`Remove project filter ${project.label}`}
            className="cursor-pointer px-1 py-0.5 hover:text-sidebar-foreground"
            onClick={() => onProjectToggle(project.key)}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      {accountLabel !== null ? (
        <span className={chipClass}>
          <button type="button" className={cn(chipButtonClass, "max-w-40")} onClick={onOpenFilter}>
            {accountLabel}
          </button>
          <button
            type="button"
            aria-label="Clear account filter"
            className="cursor-pointer px-1 py-0.5 hover:text-sidebar-foreground"
            onClick={() => onAccountChange(null)}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ) : null}
      {shownRules.map(({ rule, number }) => {
        const text = sidebarTitleRuleText(rule);
        const invalid = compiled.errors.has(rule.id);
        return (
          <span
            key={rule.id}
            className={cn(chipClass, invalid && "border-destructive/60 text-destructive")}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-pressed={rule.enabled}
                    aria-label={`Rule ${number}: ${text}`}
                    className={cn(
                      chipButtonClass,
                      "max-w-40",
                      !rule.enabled && "line-through opacity-60",
                    )}
                    onClick={() =>
                      onRulesChange((current) =>
                        setSidebarTitleRuleEnabled(current, rule.id, !rule.enabled),
                      )
                    }
                  />
                }
              >
                {text}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {compiled.errors.get(rule.id) ??
                  (rule.enabled
                    ? `${text} (click to turn off)`
                    : `${text} (off, click to turn on)`)}
              </TooltipPopup>
            </Tooltip>
            <button
              type="button"
              aria-label={`Remove rule ${number}`}
              className="cursor-pointer px-1 py-0.5 hover:text-sidebar-foreground"
              onClick={() => onRulesChange((current) => removeSidebarTitleRule(current, rule.id))}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        );
      })}
      {moreCount > 0 ? (
        <button type="button" className={cn(chipClass, chipButtonClass)} onClick={onOpenFilter}>
          +{moreCount} more
        </button>
      ) : null}
      {hiddenCount > 0 ? (
        <span className="ms-auto text-2xs text-sidebar-muted-foreground">{hiddenCount} hidden</span>
      ) : null}
    </div>
  );
}
