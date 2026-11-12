import {
  THREAD_TITLE_RULE_LIMIT,
  insertThreadTitleRule,
  threadTitleRuleFromThread,
  type ThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";

/** The thread menu's "Add title rule…" entry: `atLimit` disables it, `onAdd` runs it. */
export interface ThreadTitleRuleAction {
  readonly atLimit: boolean;
  readonly onAdd: (thread: { readonly title: string }) => void;
}

/**
 * Appends a plain-text "only" rule for the thread's title through the same persisted edit the
 * Filters sheet uses, then opens the sheet so the rule is visible. Absent while the enhanced
 * filter is off, as the sheet's rules do not filter then.
 */
export function buildThreadTitleRuleAction(input: {
  readonly enabled: boolean;
  readonly rules: ReadonlyArray<ThreadTitleRule>;
  readonly onTitleRulesChange: (
    edit: (rules: ReadonlyArray<ThreadTitleRule>) => ReadonlyArray<ThreadTitleRule>,
  ) => void;
  readonly onOpenRules: (() => void) | undefined;
  readonly newId: () => string;
}): ThreadTitleRuleAction | undefined {
  const { onOpenRules } = input;
  if (!input.enabled || onOpenRules === undefined) return undefined;
  return {
    atLimit: input.rules.length >= THREAD_TITLE_RULE_LIMIT,
    onAdd: (thread) => {
      const rule = threadTitleRuleFromThread(input.newId(), thread.title);
      if (rule === null) return;
      input.onTitleRulesChange((rules) => insertThreadTitleRule(rules, null, rule));
      onOpenRules();
    },
  };
}
