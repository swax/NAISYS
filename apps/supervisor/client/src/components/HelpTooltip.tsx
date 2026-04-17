import { ActionIcon, type MantineColor, Tooltip } from "@mantine/core";
import { IconQuestionMark } from "@tabler/icons-react";
import React from "react";

interface HelpTooltipProps {
  label: string;
  icon?: React.ReactNode;
  color?: MantineColor;
  ariaLabel?: string;
  width?: number;
}

/** ActionIcon + Tooltip wired for hover/focus/touch, used for inline help and warnings. */
export const HelpTooltip: React.FC<HelpTooltipProps> = ({
  label,
  icon,
  color = "gray",
  ariaLabel = "Help",
  width = 280,
}) => (
  <Tooltip
    label={label}
    multiline
    w={width}
    withArrow
    events={{ hover: true, focus: true, touch: true }}
  >
    <ActionIcon
      variant="subtle"
      color={color}
      radius="xl"
      aria-label={ariaLabel}
    >
      {icon ?? <IconQuestionMark size={16} />}
    </ActionIcon>
  </Tooltip>
);
