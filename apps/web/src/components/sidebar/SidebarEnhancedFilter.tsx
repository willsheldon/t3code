/**
 * The enhanced thread filter: a header button whose popover edits title rules
 * and the account, and a chip row under the search field that keeps active
 * filters visible and one click from off. State lives in the sidebar; this file
 * only renders it through the helpers in `enhancedFilter.ts`.
 */
import { PlusIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";

import { cn, randomUUID } from "~/lib/utils";
import { SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { InputGroup, InputGroupInput } from "../ui/input-group";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Toggle } from "../ui/toggle";
import { Toggle as ToggleGroupItem, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type CompiledSidebarTitleRules,
  SIDEBAR_TITLE_RULE_LIMIT,
  type SidebarTitleRule,
  hasSidebarEnhancedFilterContent,
  insertSidebarTitleRule,
  newSidebarTitleRule,
  removeSidebarTitleRule,
  setSidebarTitleRuleEnabled,
  setSidebarTitleRulePattern,
  sidebarEnhancedFilterBadgeCount,
  sidebarEnhancedFilterButtonLabel,
  sidebarTitleRuleFocusAfterRemoval,
  sidebarTitleRuleText,
  updateSidebarTitleRule,
} from "./enhancedFilter";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

type AccountOption = { readonly key: string; readonly label: string };
type RulesUpdate = (rules: ReadonlyArray<SidebarTitleRule>) => ReadonlyArray<SidebarTitleRule>;

const PATTERN_SAVE_DELAY_MS = 150;
const MAX_CHIPS = 6;

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
    }, PATTERN_SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [draft]);
  // Unmounting inside the pause would otherwise drop the last keystrokes. The
  // save is id-keyed, so it does nothing for a rule that was just removed.
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
        </InputGroup>
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

export function SidebarEnhancedFilterButton({
  rules,
  compiled,
  onRulesChange,
  accountOptions,
  selectedAccountKey,
  onAccountChange,
  open,
  onOpenChange,
}: {
  rules: ReadonlyArray<SidebarTitleRule>;
  compiled: CompiledSidebarTitleRules;
  onRulesChange: (update: RulesUpdate) => void;
  accountOptions: ReadonlyArray<AccountOption>;
  selectedAccountKey: string | null;
  onAccountChange: (key: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // A rule id, "add" for the add button, or null. A ref, not state: the rule
  // change that goes with it already re-renders, and focus follows that commit.
  const pendingFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    const element = target === "add" ? addButtonRef.current : inputs.current.get(target);
    element?.focus();
  });

  const badgeCount = sidebarEnhancedFilterBadgeCount(compiled, selectedAccountKey);
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
      <PopoverPopup
        align="end"
        side="bottom"
        className="w-[min(22rem,var(--available-width))]"
        initialFocus={() => inputs.current.get(rules[0]?.id ?? "") ?? addButtonRef.current}
      >
        <div className="flex flex-col gap-3">
          <section className="flex flex-col gap-1.5" aria-label="Title rules">
            <h3 className="text-2xs font-medium text-muted-foreground">Title rules</h3>
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    ref={addButtonRef}
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="self-start"
                    disabled={atLimit}
                    onClick={() => insertAfter(null)}
                  />
                }
              >
                <PlusIcon className="size-3.5" />
                Add rule
              </TooltipTrigger>
              {atLimit ? (
                <TooltipPopup side="top">{SIDEBAR_TITLE_RULE_LIMIT} rules maximum</TooltipPopup>
              ) : null}
            </Tooltip>
          </section>
          <section className="flex flex-col gap-1.5" aria-label="Account">
            <h3 className="text-2xs font-medium text-muted-foreground">Account</h3>
            <Select
              items={accountItems}
              value={selectedAccountKey ?? ""}
              onValueChange={(value) => onAccountChange(value ? String(value) : null)}
            >
              <SelectTrigger size="compact" aria-label="Account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} matchTriggerWidth={false}>
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
          </section>
          {hasSidebarEnhancedFilterContent(rules, selectedAccountKey) ? (
            <div className="flex justify-end border-t border-border pt-2">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => {
                  onRulesChange(() => []);
                  onAccountChange(null);
                }}
              >
                Clear all
              </Button>
            </div>
          ) : null}
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
  rules,
  compiled,
  onRulesChange,
  accountOptions,
  selectedAccountKey,
  onAccountChange,
  hiddenCount,
  onOpenFilter,
}: {
  rules: ReadonlyArray<SidebarTitleRule>;
  compiled: CompiledSidebarTitleRules;
  onRulesChange: (update: RulesUpdate) => void;
  accountOptions: ReadonlyArray<AccountOption>;
  selectedAccountKey: string | null;
  onAccountChange: (key: string | null) => void;
  hiddenCount: number;
  onOpenFilter: () => void;
}) {
  if (!hasSidebarEnhancedFilterContent(rules, selectedAccountKey)) return null;
  const accountLabel =
    selectedAccountKey === null
      ? null
      : (accountOptions.find((option) => option.key === selectedAccountKey)?.label ??
        SIDEBAR_UNAVAILABLE_ACCOUNT_LABEL);
  const ruleChips = rules
    .map((rule, index) => ({ rule, number: index + 1 }))
    .filter(({ rule }) => rule.pattern.trim() !== "");
  const ruleSlots = MAX_CHIPS - (accountLabel === null ? 0 : 1);
  const shownRules = ruleChips.slice(0, ruleSlots);
  const moreCount = ruleChips.length - shownRules.length;

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5" aria-label="Active filters">
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
