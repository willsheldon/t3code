import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ComposerQuickRepliesMenu } from "./ComposerQuickRepliesMenu";

const replies = ["Looks good.", "Can you clarify?"];

describe("ComposerQuickRepliesMenu", () => {
  it("lists configured replies in order, followed by Edit list", async () => {
    await using screen = await render(
      <ComposerQuickRepliesMenu
        replies={replies}
        disabled={false}
        onSelectReply={vi.fn()}
        onEditList={vi.fn()}
      />,
    );
    await screen.getByRole("button", { name: "Quick replies" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Edit list" })).toBeVisible();
    expect(
      page
        .getByRole("menuitem")
        .elements()
        .map((row) => row.textContent),
    ).toEqual([...replies, "Edit list"]);
  });

  it("sends the selected reply", async () => {
    const onSelectReply = vi.fn();
    await using screen = await render(
      <ComposerQuickRepliesMenu
        replies={replies}
        disabled={false}
        onSelectReply={onSelectReply}
        onEditList={vi.fn()}
      />,
    );
    await screen.getByRole("button", { name: "Quick replies" }).click();
    await page.getByRole("menuitem", { name: "Can you clarify?" }).click();
    expect(onSelectReply).toHaveBeenCalledExactlyOnceWith("Can you clarify?");
  });

  it("opens settings from Edit list", async () => {
    const onEditList = vi.fn();
    await using screen = await render(
      <ComposerQuickRepliesMenu
        replies={replies}
        disabled={false}
        onSelectReply={vi.fn()}
        onEditList={onEditList}
      />,
    );
    await screen.getByRole("button", { name: "Quick replies" }).click();
    await page.getByRole("menuitem", { name: "Edit list" }).click();
    expect(onEditList).toHaveBeenCalledTimes(1);
  });

  it("keeps Edit list available with a disabled placeholder for an empty list", async () => {
    await using screen = await render(
      <ComposerQuickRepliesMenu
        replies={[]}
        disabled={false}
        onSelectReply={vi.fn()}
        onEditList={vi.fn()}
      />,
    );
    await screen.getByRole("button", { name: "Quick replies" }).click();
    await expect.element(page.getByRole("menuitem", { name: "No quick replies" })).toBeDisabled();
    await expect.element(page.getByRole("menuitem", { name: "Edit list" })).toBeVisible();
    await expect
      .element(page.getByRole("menuitem", { name: "Looks good." }))
      .not.toBeInTheDocument();
  });

  it.each([true, false])("respects send availability (disabled=%s)", async (disabled) => {
    await using screen = await render(
      <ComposerQuickRepliesMenu
        replies={replies}
        disabled={disabled}
        onSelectReply={vi.fn()}
        onEditList={vi.fn()}
      />,
    );
    if (disabled)
      await expect.element(screen.getByRole("button", { name: "Quick replies" })).toBeDisabled();
    else await expect.element(screen.getByRole("button", { name: "Quick replies" })).toBeEnabled();
  });
});
