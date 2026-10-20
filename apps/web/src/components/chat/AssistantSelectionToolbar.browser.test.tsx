import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  EnvironmentId,
  ThreadId,
  type AssistantCitation,
} from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: "/thread/abc", hash: "" },
  quickReplies: ["Agreed.", "No."] as readonly string[],
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({
    navigate: mocks.navigate,
    get state() {
      return { location: mocks.location };
    },
  }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (
    selector: (settings: { selectionQuickReplies: readonly string[] }) => unknown,
  ) => selector({ selectionQuickReplies: mocks.quickReplies }),
}));

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const selectedText = "Selected assistant text";

function setup() {
  mocks.navigate.mockReset();
  mocks.location = { pathname: "/thread/abc", hash: "" };
  mocks.quickReplies = ["Agreed.", "No."];
  return vi.fn(
    (_citation: AssistantCitation, _anchor: AssistantCitationSourceAnchor, _reply?: string) => true,
  );
}

function Harness({
  text = selectedText,
  onCite,
}: {
  text?: string;
  onCite: (
    citation: AssistantCitation,
    anchor: AssistantCitationSourceAnchor,
    reply?: string,
  ) => boolean;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div ref={setViewport} style={{ width: 500, height: 300, overflow: "auto" }}>
        <p data-assistant-citation-source="message-1">{text}</p>
      </div>
      <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />
    </>
  );
}

async function selectText() {
  await act(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("[data-assistant-citation-source]")!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect.element(page.getByRole("group", { name: "Selection actions" })).toBeVisible();
}
const button = (name: string) => page.getByRole("button", { name, exact: true });

describe("AssistantSelectionToolbar quick replies", () => {
  it("offers Cite, the configured replies, and Edit list", async () => {
    const onCite = setup();
    await using _screen = await render(<Harness onCite={onCite} />);
    await selectText();
    await expect.element(button("Cite selection in composer")).toBeVisible();
    await expect.element(button('Cite selection and reply "Agreed."')).toBeVisible();
    await expect.element(button('Cite selection and reply "No."')).toBeVisible();
    await expect.element(button("Edit list")).toBeVisible();
  });

  it("passes the selection and quick reply to the composer, then dismisses", async () => {
    const onCite = setup();
    await using _screen = await render(<Harness onCite={onCite} />);
    await selectText();
    await button('Cite selection and reply "Agreed."').click();
    expect(onCite).toHaveBeenCalledTimes(1);
    expect(onCite.mock.calls[0]?.[0].text).toBe(selectedText);
    expect(onCite.mock.calls[0]?.[2]).toBe("Agreed.");
    await expect
      .element(page.getByRole("group", { name: "Selection actions" }))
      .not.toBeInTheDocument();
  });

  it("does not add a reply for plain Cite", async () => {
    const onCite = setup();
    await using _screen = await render(<Harness onCite={onCite} />);
    await selectText();
    await button("Cite selection in composer").click();
    expect(onCite).toHaveBeenCalledTimes(1);
    expect(onCite.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("disables Cite and hides replies and Edit list for an overlong selection", async () => {
    const onCite = setup();
    await using _screen = await render(
      <Harness text={"x".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1)} onCite={onCite} />,
    );
    await selectText();
    await expect.element(button("Selection is too long to cite")).toBeDisabled();
    await expect.element(button('Cite selection and reply "Agreed."')).not.toBeInTheDocument();
    await expect.element(button("Edit list")).not.toBeInTheDocument();
  });

  it("opens the settings anchor and dismisses from Edit list", async () => {
    const onCite = setup();
    await using _screen = await render(<Harness onCite={onCite} />);
    await selectText();
    await button("Edit list").click();
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/settings/general", hash: "selection-quick-replies" }),
    );
    await expect
      .element(page.getByRole("group", { name: "Selection actions" }))
      .not.toBeInTheDocument();
  });

  it("does not navigate again when already on the settings anchor", async () => {
    const onCite = setup();
    mocks.location = { pathname: "/settings/general", hash: "#selection-quick-replies" };
    await using _screen = await render(<Harness onCite={onCite} />);
    await selectText();
    await button("Edit list").click();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus visible while moving through a long menu", async () => {
    const onCite = setup();
    mocks.quickReplies = Array.from({ length: 40 }, (_, index) => `Reply ${index}`);
    await using _screen = await render(<Harness onCite={onCite} />);
    await selectText();
    await act(() => button("Cite selection in composer").element().focus());
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(button("Edit list")).toHaveFocus();
    const menu = page.getByRole("group", { name: "Selection actions" }).element();
    const row = button("Edit list").element();
    expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      menu.getBoundingClientRect().bottom,
    );
  });
});
