import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });

  describe("add-title-rule", () => {
    const find = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state).find((item) => item.id === "add-title-rule");

    it("is omitted unless the enhanced filter supplies it", () => {
      expect(find(baseState)).toBeUndefined();
    });

    it("follows Pin thread and disables at the rule limit", () => {
      const ids = buildThreadActionMenuItems({ ...baseState, titleRule: { atLimit: false } }).map(
        (item) => item.id,
      );
      expect(ids.indexOf("add-title-rule")).toBe(ids.indexOf("pin") + 1);
      expect(find({ ...baseState, titleRule: { atLimit: false } })?.disabled).toBeFalsy();
      expect(find({ ...baseState, titleRule: { atLimit: true } })?.disabled).toBe(true);
    });

    it("stays enabled for a read-only connection", () => {
      expect(
        find({ ...baseState, canOperate: false, titleRule: { atLimit: false } })?.disabled,
      ).toBeFalsy();
    });
  });
});
