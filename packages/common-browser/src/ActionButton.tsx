import { Button, type ButtonProps, Tooltip } from "@mantine/core";
import {
  formatDisabledReason,
  hasAction,
  type HateoasAction,
} from "@naisys/common";

export interface ActionButtonProps extends Omit<ButtonProps, "disabled"> {
  actions: HateoasAction[] | undefined;
  rel: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

/**
 * A button that is automatically shown/hidden and enabled/disabled
 * based on HATEOAS action availability.
 *
 * - If the action is not present, renders nothing.
 * - If the action is present but disabled, renders a disabled button
 *   with an optional tooltip showing the disabledReason.
 * - Otherwise renders a normal enabled button.
 */
export function ActionButton({
  actions,
  rel,
  onClick,
  ...buttonProps
}: ActionButtonProps) {
  const action = hasAction(actions, rel, { includeDisabled: true });
  if (!action) return null;

  const btn = (
    <Button
      {...buttonProps}
      disabled={action.disabled}
      onClick={action.disabled ? undefined : onClick}
    />
  );

  const reason = formatDisabledReason(action.disabledReason);

  return reason ? (
    <Tooltip
      label={reason}
      multiline
      maw={350}
      style={{ whiteSpace: "pre-line" }}
    >
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}
