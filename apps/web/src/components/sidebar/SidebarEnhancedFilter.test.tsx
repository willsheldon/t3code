import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  compileThreadTitleRules,
  newThreadTitleRule,
} from "@t3tools/client-runtime/state/thread-filters";
import {
  ProjectFilterSection,
  SidebarEnhancedFilterChips,
  StatusFilterSection,
} from "./SidebarEnhancedFilter";

const renderSection = (optionCount: number, selectedKeys: ReadonlyArray<string>) =>
  renderToStaticMarkup(
    <ProjectFilterSection
      options={Array.from({ length: optionCount }, (_, index) => ({
        key: `env:${index}`,
        label: `Project ${index}`,
      }))}
      selectedKeys={selectedKeys}
      onToggle={() => {}}
      onRowKeyDown={() => {}}
      onRowContextMenu={() => {}}
      renderIcon={() => null}
      renderActions={(key) => <span data-action={key} />}
    />,
  );

describe("ProjectFilterSection", () => {
  it("marks every selected project and keeps row actions outside the checkbox", () => {
    const html = renderSection(3, ["env:0", "env:2"]);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(1);
    expect(html).toContain('</button><span data-action="env:1">');
  });

  it("adds project search only for long lists", () => {
    expect(renderSection(8, [])).not.toContain("Search projects");
    expect(renderSection(9, [])).toContain("Search projects");
  });
});

describe("StatusFilterSection", () => {
  const counts = { input: 3, working: 1, failed: 0, done: 40 };
  const render = (doneHasMore: boolean) =>
    renderToStaticMarkup(
      <StatusFilterSection
        selected={["input"]}
        counts={counts}
        doneHasMore={doneHasMore}
        onToggle={() => {}}
        onClear={() => {}}
      />,
    );

  it("exposes each status as a checkbox and offers clear only when one is selected", () => {
    const html = render(false);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(3);
    expect(html).toContain("Clear status filters");
  });

  it("marks the Done count as a lower bound while settled history is unloaded", () => {
    expect(render(false)).not.toContain("40+");
    expect(render(true)).toContain("40+");
  });
});

describe("SidebarEnhancedFilterChips", () => {
  const rules = ["a", "b", "c", "d", "e"].map((pattern) => ({
    ...newThreadTitleRule(pattern),
    pattern,
  }));

  it("gives statuses their slots and counts what no longer fits", () => {
    const html = renderToStaticMarkup(
      <SidebarEnhancedFilterChips
        statuses={["input", "done"]}
        onStatusToggle={() => {}}
        rules={rules}
        compiled={compileThreadTitleRules(rules)}
        onRulesChange={() => {}}
        accountOptions={[]}
        selectedAccountKey={null}
        onAccountChange={() => {}}
        projects={[]}
        onProjectToggle={() => {}}
        renderProjectIcon={() => null}
        hiddenCount={0}
        onOpenFilter={() => {}}
      />,
    );
    expect(html).toContain("Remove status filter Input");
    expect(html).toContain("Remove status filter Done");
    expect(html.match(/aria-label="Remove rule/g)).toHaveLength(4);
    expect(html).toContain("+1 more");
  });
});
