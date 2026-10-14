import { useRouter } from "@tanstack/react-router";
import { useStableCallback } from "./useStableCallback";
import { scrollToSettingsTarget } from "~/components/settings/settingsLayout";

/** Matches the settings search catalog id and row id in SettingsPanels.tsx. */
export const SELECTION_QUICK_REPLIES_SETTINGS_ANCHOR = "selection-quick-replies";

/**
 * Every "Edit list" entry point (the selection toolbar, the composer menu)
 * sends the user to the same settings row: scroll to it when already there,
 * otherwise navigate with the anchor so the row highlights on arrival.
 */
export function useNavigateToQuickRepliesSettings(): () => void {
  // Reads the location at click time instead of subscribing to it, so callers
  // (the composer is a hot component) get a stable callback and no re-render
  // on route changes.
  const router = useRouter();

  return useStableCallback(() => {
    const { pathname, hash } = router.state.location;
    if (
      pathname === "/settings/general" &&
      hash.replace(/^#/, "") === SELECTION_QUICK_REPLIES_SETTINGS_ANCHOR
    ) {
      scrollToSettingsTarget(SELECTION_QUICK_REPLIES_SETTINGS_ANCHOR);
      return;
    }
    void router.navigate({
      to: "/settings/general",
      hash: SELECTION_QUICK_REPLIES_SETTINGS_ANCHOR,
      hashScrollIntoView: false,
      state: { settingsTargetHighlight: true },
    });
  });
}
