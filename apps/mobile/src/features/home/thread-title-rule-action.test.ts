import {
  THREAD_TITLE_RULE_LIMIT,
  type ThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";
import { describe, expect, it, vi } from "vite-plus/test";

import { buildThreadTitleRuleAction } from "./thread-title-rule-action";

const rule = (id: string): ThreadTitleRule => ({
  id,
  mode: "hide",
  pattern: "x",
  regex: false,
  enabled: true,
  tripped: false,
});

const build = (overrides: Partial<Parameters<typeof buildThreadTitleRuleAction>[0]> = {}) => {
  let rules: ReadonlyArray<ThreadTitleRule> = overrides.rules ?? [rule("a")];
  const onOpenRules = vi.fn();
  const action = buildThreadTitleRuleAction({
    enabled: true,
    rules,
    onTitleRulesChange: (edit) => {
      rules = edit(rules);
    },
    onOpenRules,
    newId: () => "new",
    ...overrides,
  });
  return { action, onOpenRules, rules: () => rules };
};

describe("buildThreadTitleRuleAction", () => {
  it("is absent while the enhanced filter is off or the sheet cannot open", () => {
    expect(build({ enabled: false }).action).toBeUndefined();
    expect(build({ onOpenRules: undefined }).action).toBeUndefined();
  });

  it("appends an only rule for the title, then opens the sheet", () => {
    const { action, onOpenRules, rules } = build();
    action?.onAdd({ title: " Fix login " });
    expect(rules().map((r) => r.id)).toEqual(["a", "new"]);
    expect(rules().at(-1)).toMatchObject({ mode: "only", pattern: "Fix login", regex: false });
    expect(onOpenRules).toHaveBeenCalledOnce();
  });

  it("changes nothing for a blank title", () => {
    const { action, onOpenRules, rules } = build();
    action?.onAdd({ title: "  " });
    expect(rules()).toHaveLength(1);
    expect(onOpenRules).not.toHaveBeenCalled();
  });

  it("reports the limit", () => {
    const full = Array.from({ length: THREAD_TITLE_RULE_LIMIT }, (_, i) => rule(`${i}`));
    expect(build({ rules: full }).action?.atLimit).toBe(true);
    expect(build().action?.atLimit).toBe(false);
  });
});
