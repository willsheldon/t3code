import {
  THREAD_TITLE_RULE_LIMIT,
  compileThreadTitleRules,
  insertThreadTitleRule,
  newThreadTitleRule,
  removeThreadTitleRule,
  setThreadTitleRuleEnabled,
  setThreadTitleRulePattern,
  updateThreadTitleRule,
  type ThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ListSection } from "../../components/ui/ListSection";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";

type Rules = ReadonlyArray<ThreadTitleRule>;

/** How long typing pauses before the pattern filters the list and is saved. */
const PATTERN_COMMIT_DELAY_MS = 400;

const MODE_OPTIONS = [
  { value: "hide", label: "Hide", accessibilityLabel: "Hide threads that match" },
  { value: "only", label: "Only", accessibilityLabel: "Show only threads that match" },
] as const;

function RuleRow(props: {
  readonly rule: ThreadTitleRule;
  readonly error: string | undefined;
  readonly isLast: boolean;
  readonly onChange: (update: (rules: Rules) => Rules) => void;
}) {
  const { rule } = props;
  const [draft, setDraft] = useState(rule.pattern);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A pattern changed from outside (Reset, another screen) replaces the draft.
  const [seenPattern, setSeenPattern] = useState(rule.pattern);
  // The latest draft and change handler, so an unmount can still save a pattern typed just before it.
  const pending = useRef<{ draft: string; onChange: typeof props.onChange; ruleId: string } | null>(
    null,
  );
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  };
  if (seenPattern !== rule.pattern) {
    setSeenPattern(rule.pattern);
    setDraft(rule.pattern);
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an outside pattern edit cancels the pending save of older typed text.
  useEffect(() => {
    if (pending.current === null || pending.current.draft === rule.pattern) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, [rule.pattern]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves an uncommitted draft when the row unmounts.
  useEffect(
    () => () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      const last = pending.current;
      pending.current = null;
      // A rule that Remove or Reset already dropped is ignored by setThreadTitleRulePattern.
      if (!last) return;
      // Unchanged text saves nothing, so a tripped rule keeps its warning.
      last.onChange((rules) =>
        rules.find((entry) => entry.id === last.ruleId)?.pattern === last.draft
          ? rules
          : setThreadTitleRulePattern(rules, last.ruleId, last.draft),
      );
    },
    [],
  );
  // Typing updates only the draft: the list re-filters and storage is written once typing
  // pauses, or at once when the field loses focus.
  const commit = (pattern: string) => {
    clearTimer();
    if (pattern !== rule.pattern) {
      props.onChange((rules) => setThreadTitleRulePattern(rules, rule.id, pattern));
    }
  };
  const label = rule.pattern.trim() === "" ? "new rule" : rule.pattern.trim();
  return (
    <View
      className={cn("gap-2 px-4 py-3", !props.isLast && "border-b border-border-subtle")}
      accessibilityLabel={`Title rule, ${label}`}
    >
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <SegmentedControl
            size="compact"
            variant="card"
            options={MODE_OPTIONS}
            selected={rule.mode}
            onSelect={(mode) =>
              props.onChange((rules) => updateThreadTitleRule(rules, rule.id, { mode }))
            }
          />
        </View>
        <ThemedSwitch
          accessibilityLabel={`Rule ${label} on`}
          value={rule.enabled}
          onValueChange={(enabled) =>
            props.onChange((rules) => setThreadTitleRuleEnabled(rules, rule.id, enabled))
          }
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove rule ${label}`}
          hitSlop={8}
          className="size-8 items-center justify-center active:opacity-70"
          onPress={() => {
            clearTimer();
            props.onChange((rules) => removeThreadTitleRule(rules, rule.id));
          }}
        >
          <SymbolView name="trash" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      </View>
      <View className="flex-row items-center gap-2">
        <TextInput
          accessibilityLabel={`Title pattern, ${rule.mode}`}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          placeholder={rule.regex ? "Regular expression" : "Text in the title"}
          placeholderTextColorClassName="accent-placeholder"
          selectionColorClassName="accent-focus/32"
          cursorColorClassName="accent-focus"
          selectionHandleColorClassName="accent-focus"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-input-border bg-input px-3 font-sans text-base text-foreground"
          value={draft}
          onChangeText={(text) => {
            setDraft(text);
            clearTimer();
            pending.current = { draft: text, onChange: props.onChange, ruleId: rule.id };
            timer.current = setTimeout(() => commit(text), PATTERN_COMMIT_DELAY_MS);
          }}
          onBlur={() => commit(draft)}
          onSubmitEditing={() => commit(draft)}
        />
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-foreground-muted">Regex</Text>
          <ThemedSwitch
            accessibilityLabel={`Rule ${label} is a regular expression`}
            value={rule.regex}
            onValueChange={(regex) =>
              props.onChange((rules) => updateThreadTitleRule(rules, rule.id, { regex }))
            }
          />
        </View>
      </View>
      {props.error === undefined ? null : (
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {props.error}
        </Text>
      )}
    </View>
  );
}

/**
 * Title rules in the filter sheet: hide or keep only the threads whose title matches. The
 * rules are the web sidebar's, shared through `@t3tools/client-runtime/state/thread-filters`.
 */
export function TitleRulesSection(props: {
  readonly rules: Rules;
  /** Takes an edit of the rules as they are when it runs. */
  readonly onChange: (edit: (rules: Rules) => Rules) => void;
}) {
  // The list compiles the same rules, so this reuses its result; it carries the parse errors
  // and the hang guard's message.
  const { errors } = compileThreadTitleRules(props.rules);
  const full = props.rules.length >= THREAD_TITLE_RULE_LIMIT;
  return (
    <ListSection
      title="Title rules"
      footer={
        props.rules.length === 0
          ? "Hide threads, or show only threads, whose title contains some text or matches a regular expression."
          : undefined
      }
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add title rule"
          accessibilityState={{ disabled: full }}
          disabled={full}
          hitSlop={8}
          className={cn("px-2 py-1 active:opacity-70", full && "opacity-45")}
          onPress={() =>
            props.onChange((rules) =>
              insertThreadTitleRule(rules, null, newThreadTitleRule(uuidv4())),
            )
          }
        >
          <Text className="text-base font-t3-medium text-primary-text">Add rule</Text>
        </Pressable>
      }
    >
      {props.rules.map((rule, index) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          error={errors.get(rule.id)}
          isLast={index === props.rules.length - 1}
          onChange={props.onChange}
        />
      ))}
    </ListSection>
  );
}
