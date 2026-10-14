import { describe, expect, it } from "vite-plus/test";
import { placeSelectionActionMenu } from "./selectionActions";

describe("placeSelectionActionMenu", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 200, height: 300 };

  it("opens below the selection when it fits", () => {
    expect(
      placeSelectionActionMenu({ position: { x: 100, y: 200 }, anchorTop: 180, size, viewport }),
    ).toEqual({ x: 100, y: 200 });
  });

  it("opens above the selection instead of covering it near the bottom", () => {
    expect(
      placeSelectionActionMenu({ position: { x: 100, y: 700 }, anchorTop: 660, size, viewport }),
    ).toEqual({ x: 100, y: 356 });
  });

  it("clamps into the viewport when neither side has room", () => {
    expect(
      placeSelectionActionMenu({
        position: { x: 950, y: 300 },
        anchorTop: 250,
        size: { width: 200, height: 700 },
        viewport,
      }),
    ).toEqual({ x: 792, y: 92 });
  });
});
