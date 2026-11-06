import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProjectFilterSection } from "./SidebarEnhancedFilter";

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
