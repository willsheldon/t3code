import { MessageSquareReplyIcon } from "lucide-react";
import { memo } from "react";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuItemLabel, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ComposerQuickRepliesMenuProps {
  /** The configured replies, in the order they should list and send. */
  replies: ReadonlyArray<string>;
  /** Disables the trigger: the composer cannot take or send text right now. */
  disabled: boolean;
  /** Appends the reply to the composer and sends it through the normal send path. */
  onSelectReply: (reply: string) => void;
  /** Navigates to the quick replies row in Settings. */
  onEditList: () => void;
}

/**
 * Compact composer-footer control for sending a configured quick reply
 * immediately, or jumping to the list to edit it. Mirrors the selection
 * toolbar's quick replies, but sends instead of only filling the composer.
 */
export const ComposerQuickRepliesMenu = memo(function ComposerQuickRepliesMenu({
  replies,
  disabled,
  onSelectReply,
  onEditList,
}: ComposerQuickRepliesMenuProps) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  aria-label="Quick replies"
                />
              }
            />
          }
        >
          <MessageSquareReplyIcon />
        </TooltipTrigger>
        <TooltipPopup>Quick replies</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" sideOffset={6}>
        {replies.length > 0 ? (
          replies.map((reply, index) => (
            <MenuItem // oxlint-disable-next-line react/no-array-index-key -- Saved lists can contain duplicate reply text.
              key={`${index}:${reply}`}
              onClick={() => onSelectReply(reply)}
            >
              <MenuItemLabel>{reply}</MenuItemLabel>
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled>
            <MenuItemLabel>No quick replies</MenuItemLabel>
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem onClick={onEditList}>
          <MenuItemLabel>Edit list</MenuItemLabel>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});
