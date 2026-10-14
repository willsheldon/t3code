import { useLocation, useNavigate } from "@tanstack/react-router";
import { scrollToSettingsTarget } from "~/components/settings/settingsLayout";

/** Matches the settings search catalog id and row id in SettingsPanels.tsx. */
export const SELECTION_QUICK_REPLIES_SETTINGS_ANCHOR = "selection-quick-replies";

/**
 * Every "Edit list" entry point (the selection toolbar, the composer menu)
 * sends the user to the same settings row: scroll to it when already there,
 * otherwise navigate with the anchor so the row highlights on arrival.
 */
export function useNavigateToQuickRepliesSettings(): () => void {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const hash = useLocation({ select: (location) => location.hash });

  return () => {
    if (
      pathname === "/settings/general" &&
      hash.replace(/^#/, "") === SELECTION_QUICK_REPLIES_SETTINGS_ANCHOR
    ) {
      scrollToSettingsTarget(SELECTION_QUICK_REPLIES_SETTINGS_ANCHOR);
      return;
    }
    void navigate({
      to: "/settings/general",
      hash: SELECTION_QUICK_REPLIES_SETTINGS_ANCHOR,
      hashScrollIntoView: false,
      state: { settingsTargetHighlight: true },
    });
  };
}
