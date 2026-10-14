// @vitest-environment jsdom
import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  EnvironmentId,
  ThreadId,
  type AssistantCitation,
} from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { pathname: "/thread/abc", hash: "" },
  quickReplies: ["Agreed.", "No."] as readonly string[],
  capture: null as {
    source: { dataset: { assistantCitationSource: string } };
    range: unknown;
    selector: { text: string; start: number; end: number; prefix: string; suffix: string };
  } | null,
}));

const router = {
  navigate: (...args: unknown[]) => mocks.navigate(...args),
  get state() {
    return { location: mocks.location };
  },
};
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => router,
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (
    selector: (settings: { selectionQuickReplies: readonly string[] }) => unknown,
  ) => selector({ selectionQuickReplies: mocks.quickReplies }),
}));
vi.mock("~/lib/assistantTextSelection", () => ({
  captureAssistantTextSelection: () => mocks.capture,
}));
// The container's own selection-capture wiring is covered by
// lib/selectionActions.test.ts; here it only needs to report the fake
// selection synchronously so the toolbar renders.
vi.mock("~/lib/selectionActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/selectionActions")>();
  return {
    ...actual,
    observeSelectionActions: (options: { onSelection: (pointer: null) => void }) => {
      options.onSelection(null);
      return { cancel: vi.fn(), selectionChanged: vi.fn(), dispose: vi.fn() };
    },
  };
});
vi.mock("../ui/button", () => ({
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));
// react-test-renderer has no real DOM to portal into; render the toolbar in place.
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, createPortal: (node: ReactNode) => node };
});

import { AssistantSelectionToolbar } from "./AssistantSelectionToolbar";

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

const fakeRect = { top: 10, bottom: 20, left: 10, right: 50, width: 40, height: 10 };
function fakeRange() {
  return {
    getBoundingClientRect: () => fakeRect,
    getClientRects: () => Object.assign([fakeRect], { item: (index: number) => [fakeRect][index] }),
  };
}

function setCapturedSelection(text: string) {
  mocks.capture = {
    source: { dataset: { assistantCitationSource: "message-1" } },
    range: fakeRange(),
    selector: { text, start: 0, end: text.length, prefix: "", suffix: "" },
  };
}

let renderer: ReactTestRenderer;

function mount(
  onCite = vi.fn(
    (
      _citation: AssistantCitation,
      _sourceAnchor: AssistantCitationSourceAnchor,
      _replyText?: string,
    ) => true,
  ),
) {
  const viewport = document.createElement("div");
  viewport.getBoundingClientRect = () => ({
    top: 0,
    bottom: 1000,
    left: 0,
    right: 1000,
    width: 1000,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  act(() => {
    renderer = create(
      <AssistantSelectionToolbar viewport={viewport} threadRef={threadRef} onCite={onCite} />,
    );
  });
  return onCite;
}

function findButton(label: string) {
  return renderer.root.findAllByType("button").find((button) => {
    const children = button.props.children;
    return Array.isArray(children) ? children.includes(label) : children === label;
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.navigate.mockReset();
  mocks.location = { pathname: "/thread/abc", hash: "" };
  mocks.quickReplies = ["Agreed.", "No."];
  setCapturedSelection("Selected assistant text");
});

afterEach(() => {
  act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("AssistantSelectionToolbar quick replies", () => {
  it("renders Cite, one button per quick reply, and an Edit list link", () => {
    mount();
    expect(findButton("Cite")).toBeDefined();
    expect(findButton("Agreed.")).toBeDefined();
    expect(findButton("No.")).toBeDefined();
    expect(findButton("Edit list")).toBeDefined();
  });

  it("cites the selection and appends the reply text when a quick reply is clicked", () => {
    const onCite = mount();
    act(() => findButton("Agreed.")!.props.onClick());
    expect(onCite).toHaveBeenCalledTimes(1);
    const [citation, , replyText] = onCite.mock.calls[0]!;
    expect(citation.text).toBe("Selected assistant text");
    expect(replyText).toBe("Agreed.");
    // A successful cite dismisses the toolbar.
    expect(findButton("Cite")).toBeUndefined();
  });

  it("does not insert a reply when the plain Cite button is clicked", () => {
    const onCite = mount();
    act(() => findButton("Cite")!.props.onClick());
    expect(onCite).toHaveBeenCalledTimes(1);
    const [, , replyText] = onCite.mock.calls[0]!;
    expect(replyText).toBeUndefined();
  });

  it("hides quick replies and Edit list when the selection is too long", () => {
    setCapturedSelection("x".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1));
    mount();
    expect(findButton("Shorten selection")).toBeDefined();
    expect(findButton("Agreed.")).toBeUndefined();
    expect(findButton("Edit list")).toBeUndefined();
  });

  it("navigates to the settings anchor and dismisses when Edit list is clicked", () => {
    mount();
    act(() => findButton("Edit list")!.props.onClick());
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/settings/general", hash: "selection-quick-replies" }),
    );
    expect(findButton("Cite")).toBeUndefined();
  });

  it("does not navigate when Edit list is clicked while already on the target anchor", () => {
    mocks.location = { pathname: "/settings/general", hash: "#selection-quick-replies" };
    mount();
    act(() => findButton("Edit list")!.props.onClick());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
