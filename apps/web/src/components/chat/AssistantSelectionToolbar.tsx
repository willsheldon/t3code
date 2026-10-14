import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { MessageSquareReplyIcon, QuoteIcon, Settings2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigateToQuickRepliesSettings } from "~/hooks/useQuickRepliesSettingsNavigation";
import { useClientSettings } from "~/hooks/useSettings";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  placeSelectionActionMenu,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
    replyText?: string,
  ) => boolean;
}) {
  const navigateToQuickRepliesSettings = useNavigateToQuickRepliesSettings();
  const quickReplies = useClientSettings((settings) => settings.selectionQuickReplies);
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    /** Top of the selected text, so a tall menu can open above it instead. */
    anchorTop: number;
    sourceAnchor: AssistantCitationSourceAnchor;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const citeButtonRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    const placement = placeSelectionActionMenu({
      position: selection.position,
      anchorTop: selection.anchorTop,
      size: { width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    toolbar.style.left = `${placement.x}px`;
    toolbar.style.top = `${placement.y}px`;
  }, [selection]);

  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (!isSelectionRectVisible(rect, [viewportRect])) {
        clear();
        return;
      }
      // A selection can cross blocks with different clipping ancestors.
      const common = captured.range.commonAncestorContainer;
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
      let visible = false;
      for (; node && !visible; node = walker.nextNode()) {
        if (!captured.range.intersectsNode(node)) continue;
        if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none")
          continue;
        const fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (node === captured.range.startContainer) {
          fragment.setStart(node, captured.range.startOffset);
        }
        if (node === captured.range.endContainer) {
          fragment.setEnd(node, captured.range.endOffset);
        }
        if (!fragment.toString().trim()) continue;
        const lines = Array.from(fragment.getClientRects());
        if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
        const clips: Pick<DOMRect, "left" | "right" | "top" | "bottom">[] = [viewportRect];
        for (
          let element = node.parentElement;
          element && element !== viewport;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          const clipX = style.overflowX !== "visible";
          const clipY = style.overflowY !== "visible";
          if (!clipX && !clipY) continue;
          const bounds = element.getBoundingClientRect();
          const left = bounds.left + element.clientLeft;
          const top = bounds.top + element.clientTop;
          clips.push({
            left: clipX ? left : -Infinity,
            right: clipX ? left + element.clientWidth : Infinity,
            top: clipY ? top : -Infinity,
            bottom: clipY ? top + element.clientHeight : Infinity,
          });
        }
        visible = lines.some((line) => isSelectionRectVisible(line, clips));
      }
      if (!visible) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      setSelection({
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...captured.selector,
        },
        anchorTop: rect.top,
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      const firstButton = citeButtonRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        !firstButton ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      if (firstButton.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      firstButton.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [threadRef, viewport]);

  if (!selection) return null;
  const tooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const cite = (replyText?: string): boolean => {
    if (tooLong || !onCite(selection.citation, selection.sourceAnchor, replyText)) return false;
    window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };
  const editList = () => {
    dismiss();
    navigateToQuickRepliesSettings();
  };
  return createPortal(
    <div
      ref={toolbarRef}
      role="group"
      aria-label="Selection actions"
      className="dropdown-glass fixed z-50 flex max-h-[calc(100vh-1rem)] w-max min-w-40 max-w-[min(18rem,calc(100vw-1rem))] flex-col overflow-y-auto rounded-lg p-1 shadow-lg"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          dismiss();
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          moveSelectionActionFocus(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
        }
      }}
    >
      <button
        ref={citeButtonRef}
        type="button"
        className={SELECTION_ACTION_ROW_CLASS_NAME}
        disabled={tooLong}
        aria-label={tooLong ? "Selection is too long to cite" : "Cite selection in composer"}
        onClick={() => cite()}
      >
        <QuoteIcon aria-hidden="true" />
        {tooLong ? "Shorten selection" : "Cite"}
      </button>
      {tooLong ? null : (
        <>
          {quickReplies.length > 0 ? (
            <>
              <div aria-hidden="true" className="mx-2 my-1 h-px shrink-0 bg-border" />
              <div
                aria-hidden="true"
                className="px-2 pt-0.5 pb-1 font-medium text-muted-foreground text-xs"
              >
                Reply
              </div>
              {quickReplies.map((reply, index) => (
                <button
                  key={`${index}:${reply}`}
                  type="button"
                  className={SELECTION_ACTION_ROW_CLASS_NAME}
                  aria-label={`Cite selection and reply "${reply}"`}
                  onClick={() => cite(reply)}
                >
                  <MessageSquareReplyIcon aria-hidden="true" />
                  <span className="min-w-0 truncate">{reply}</span>
                </button>
              ))}
            </>
          ) : null}
          <div aria-hidden="true" className="mx-2 my-1 h-px shrink-0 bg-border" />
          <button type="button" className={SELECTION_ACTION_ROW_CLASS_NAME} onClick={editList}>
            <Settings2Icon aria-hidden="true" />
            Edit list
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

// Matches MenuItem rows so the selection popup reads as the app's other menus.
const SELECTION_ACTION_ROW_CLASS_NAME =
  "[&>svg]:-mx-0.5 flex min-h-8 w-full shrink-0 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1 text-left text-base text-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-64 sm:min-h-7 sm:text-sm [&>svg]:pointer-events-none [&>svg]:size-4.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground [&>svg]:opacity-80 sm:[&>svg]:size-4";

function moveSelectionActionFocus(container: HTMLElement, step: 1 | -1): void {
  const rows = Array.from(container.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  if (rows.length === 0) return;
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = current === -1 ? 0 : (current + step + rows.length) % rows.length;
  const row = rows[next];
  if (!row) return;
  row.focus({ preventScroll: true });
  // Keep the focused row visible in a scrolling menu without moving the chat.
  if (row.offsetTop < container.scrollTop) {
    container.scrollTop = row.offsetTop;
  } else if (row.offsetTop + row.offsetHeight > container.scrollTop + container.clientHeight) {
    container.scrollTop = row.offsetTop + row.offsetHeight - container.clientHeight;
  }
}
