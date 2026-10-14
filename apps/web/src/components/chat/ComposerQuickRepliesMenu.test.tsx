import { cloneElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// Base UI's real Menu/Tooltip portal and position on mount, which
// react-test-renderer cannot do. These stand-ins keep the trigger/popup
// wiring (the `render` prop merge, `disabled`, `onClick`) and always render
// the popup content, matching the pattern other composer menu tests use.
vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
  TooltipPopup: () => null,
}));
vi.mock("../ui/menu", () => ({
  Menu: ({ children }: { children: ReactNode }) => <div data-menu="true">{children}</div>,
  MenuTrigger: ({
    render,
    children,
    disabled,
  }: {
    render: ReactElement<{ disabled?: boolean }>;
    children: ReactNode;
    disabled?: boolean;
  }) => cloneElement(render, disabled === undefined ? {} : { disabled }, children),
  MenuPopup: "section",
  MenuItem: "button",
  MenuItemLabel: "span",
  MenuSeparator: "hr",
}));

import { ComposerQuickRepliesMenu } from "./ComposerQuickRepliesMenu";

let renderer: ReactTestRenderer;

function mount(props: Partial<React.ComponentProps<typeof ComposerQuickRepliesMenu>> = {}) {
  const onSelectReply = vi.fn();
  const onEditList = vi.fn();
  act(() => {
    renderer = create(
      <ComposerQuickRepliesMenu
        replies={["Looks good.", "Can you clarify?"]}
        disabled={false}
        onSelectReply={onSelectReply}
        onEditList={onEditList}
        {...props}
      />,
    );
  });
  return { onSelectReply, onEditList };
}

/** Every menu item is `<button><span>label</span></button>`; find the label, then its button. */
function findMenuItemButton(label: string): ReactTestInstance | undefined {
  const labelSpan = renderer.root
    .findAllByType("span")
    .find((span) => span.props.children === label);
  let node: ReactTestInstance | null = labelSpan?.parent ?? null;
  while (node && node.type !== "button") node = node.parent;
  return node ?? undefined;
}

function findTrigger(): ReactTestInstance | undefined {
  return renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-label"] === "Quick replies");
}

afterEach(() => {
  act(() => renderer?.unmount());
});

describe("ComposerQuickRepliesMenu", () => {
  it("lists the configured replies in order, followed by Edit list", () => {
    mount();
    const labels = renderer.root
      .findAllByType("span")
      .map((span) => span.props.children)
      .filter((children): children is string => typeof children === "string");
    expect(labels).toEqual(["Looks good.", "Can you clarify?", "Edit list"]);
  });

  it("sends the selected reply", () => {
    const { onSelectReply } = mount();
    act(() => findMenuItemButton("Can you clarify?")!.props.onClick());
    expect(onSelectReply).toHaveBeenCalledTimes(1);
    expect(onSelectReply).toHaveBeenCalledWith("Can you clarify?");
  });

  it("navigates when Edit list is clicked", () => {
    const { onEditList } = mount();
    act(() => findMenuItemButton("Edit list")!.props.onClick());
    expect(onEditList).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled placeholder and Edit list when there are no quick replies", () => {
    mount({ replies: [] });
    const placeholder = findMenuItemButton("No quick replies");
    expect(placeholder?.props.disabled).toBe(true);
    expect(findMenuItemButton("Edit list")).toBeDefined();
    expect(findMenuItemButton("Looks good.")).toBeUndefined();
  });

  it("disables the trigger when the composer cannot send", () => {
    mount({ disabled: true });
    expect(findTrigger()?.props.disabled).toBe(true);
  });

  it("enables the trigger when the composer can send", () => {
    mount({ disabled: false });
    expect(findTrigger()?.props.disabled).toBe(false);
  });
});
