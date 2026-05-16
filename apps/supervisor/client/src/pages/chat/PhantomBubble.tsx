import { Box, Paper, Text } from "@mantine/core";
import React from "react";

import type { ThreadRunCommand } from "../../hooks/useThreadRunCommands";
import { ActiveSubagentBadge } from "./ActiveSubagentBadge";
import { otherStyle, ownStyle } from "./chatThreadHelpers";
import { CommandList } from "./CommandList";

// Bubble shown for command activity that has no chat message of its own.
// active: trailing + agent online (blue border + spinner)
// inactive: trailing + agent stopped (dashed + "(no reply)")
// historical: between two other-user messages (default border, no spinner)
interface PhantomBubbleProps {
  username: string;
  title: string;
  cmds: ThreadRunCommand[];
  kind: "active" | "inactive" | "historical";
  isOwn: boolean;
  activeSubagentCount: number;
  expanded: boolean;
  onToggle: () => void;
  onCommandClick: (cmd: ThreadRunCommand) => void;
}

export const PhantomBubble: React.FC<PhantomBubbleProps> = ({
  username,
  title,
  cmds,
  kind,
  isOwn,
  activeSubagentCount,
  expanded,
  onToggle,
  onCommandClick,
}) => {
  const showSpinner = kind === "active";
  const showNoReply = kind === "inactive";
  const borderOverride =
    kind === "active"
      ? "1px solid var(--mantine-color-blue-4)"
      : kind === "inactive"
        ? "1px dashed var(--mantine-color-dark-3)"
        : undefined;

  return (
    <Box
      style={{
        display: "flex",
        justifyContent: isOwn ? "flex-end" : "flex-start",
      }}
    >
      <Paper
        p="xs"
        px="sm"
        radius="lg"
        style={{
          maxWidth: "75%",
          ...(isOwn ? ownStyle : otherStyle),
          ...(borderOverride ? { border: borderOverride } : {}),
        }}
      >
        {!isOwn && (
          <Text size="xs" fw={600} c="dimmed" mb={2}>
            {username}
            {title ? ` (${title})` : ""}
          </Text>
        )}
        {kind === "active" && (
          <ActiveSubagentBadge count={activeSubagentCount} isOwn={isOwn} />
        )}
        <CommandList
          cmds={cmds}
          isOwn={isOwn}
          isActive={showSpinner}
          isPhantom={true}
          expanded={expanded}
          onToggle={onToggle}
          onCommandClick={onCommandClick}
        />
        {showNoReply && (
          <Text
            size="xs"
            fs="italic"
            c={isOwn ? "rgba(255,255,255,0.7)" : "dimmed"}
          >
            (no reply)
          </Text>
        )}
      </Paper>
    </Box>
  );
};
