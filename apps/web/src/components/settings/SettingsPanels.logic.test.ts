import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";
import {
  addSelectionQuickReply,
  moveSelectionQuickReply,
  removeSelectionQuickReply,
  resetSelectionQuickReplies,
  backgroundActivitySharedPolicySettings,
  getChangedBrowserSettingLabels,
  hasChangedBackgroundActivitySettings,
} from "./SettingsPanels.logic";

describe("background activity settings restore", () => {
  it("detects legacy interval values even when the structured setting is at its default", () => {
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: Duration.seconds(45),
        providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      }),
    ).toBe(true);
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
        backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
        automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
        providerHealthRefreshInterval: Duration.minutes(7),
      }),
    ).toBe(true);
    expect(hasChangedBackgroundActivitySettings(DEFAULT_UNIFIED_SETTINGS)).toBe(false);
  });

  it("preserves advanced overrides when the shared policy changes", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          backgroundActivity: {
            schemaVersion: 1,
            profile: "custom",
            baseProfile: "balanced",
            overrides: {
              automaticGitFetchInterval,
              pauseWhenOnBattery: true,
            },
          },
        },
        "performance",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval,
        pauseWhenOnBattery: true,
      },
    });
  });

  it("materializes legacy advanced overrides before changing the shared policy", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          automaticGitFetchInterval,
        },
        "battery-saver",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "battery-saver",
      overrides: {
        automaticGitFetchInterval,
      },
    });
  });
});

describe("getChangedBrowserSettingLabels", () => {
  it("counts a retained custom search URL so restore clears it", () => {
    expect(
      getChangedBrowserSettingLabels({
        ...DEFAULT_UNIFIED_SETTINGS,
        browserCustomSearchUrl: "https://search.example/?q=%s",
      }),
    ).toEqual(["Search engine"]);
  });
});

describe("selection quick replies", () => {
  it("appends a trimmed reply", () => {
    expect(addSelectionQuickReply(["Agreed."], "  No.  ")).toEqual(["Agreed.", "No."]);
  });

  it("ignores a blank reply", () => {
    const replies = ["Agreed."];
    expect(addSelectionQuickReply(replies, "   ")).toBe(replies);
  });

  it("ignores an exact duplicate", () => {
    const replies = ["Agreed.", "No."];
    expect(addSelectionQuickReply(replies, "No.")).toBe(replies);
    expect(addSelectionQuickReply(replies, "  No.  ")).toBe(replies);
  });

  it("removes the entry at the given index", () => {
    expect(removeSelectionQuickReply(["Agreed.", "No.", "Why?"], 1)).toEqual(["Agreed.", "Why?"]);
  });

  it("leaves the list unchanged for an out-of-range remove", () => {
    const replies = ["Agreed."];
    expect(removeSelectionQuickReply(replies, -1)).toBe(replies);
    expect(removeSelectionQuickReply(replies, 5)).toBe(replies);
  });

  it("moves an entry up or down", () => {
    const replies = ["Agreed.", "No.", "Why?"];
    expect(moveSelectionQuickReply(replies, 1, -1)).toEqual(["No.", "Agreed.", "Why?"]);
    expect(moveSelectionQuickReply(replies, 1, 1)).toEqual(["Agreed.", "Why?", "No."]);
  });

  it("leaves the list unchanged when a move would go past either end", () => {
    const replies = ["Agreed.", "No."];
    expect(moveSelectionQuickReply(replies, 0, -1)).toBe(replies);
    expect(moveSelectionQuickReply(replies, 1, 1)).toBe(replies);
  });

  it("resets to a fresh copy of the built-in defaults", () => {
    const reset = resetSelectionQuickReplies();
    expect(reset).toEqual(["Agreed.", "Approved", "Fix this.", "what?", "done", "No.", "yes"]);
    expect(resetSelectionQuickReplies()).not.toBe(reset);
  });
});
