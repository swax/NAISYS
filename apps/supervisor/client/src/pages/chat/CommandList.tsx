import {
  Box,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import React from "react";

import type { ThreadRunCommand } from "../../hooks/useThreadRunCommands";
import { parseCommandIcon } from "../../lib/commandIcons";
import { firstLine, tooltipText } from "./chatThreadHelpers";

interface CommandListProps {
  cmds: ThreadRunCommand[];
  isOwn: boolean;
  isActive: boolean;
  isPhantom: boolean;
  expanded: boolean;
  onToggle: () => void;
  onCommandClick: (cmd: ThreadRunCommand) => void;
}

export const CommandList: React.FC<CommandListProps> = ({
  cmds,
  isOwn,
  isActive,
  isPhantom,
  expanded,
  onToggle,
  onCommandClick,
}) => {
  if (cmds.length === 0) return null;

  // Surface the latest cmd while collapsed for any list with live activity
  // — phantom bubbles always do this, and active footers do it too so the
  // pulsing icon is visible without forcing the user to expand.
  const surfaceLatestWhenCollapsed = isPhantom || isActive;
  const visible = expanded
    ? cmds
    : surfaceLatestWhenCollapsed
      ? [cmds[cmds.length - 1]]
      : [];
  const latestId = cmds[cmds.length - 1].logId;
  const showToggle = !surfaceLatestWhenCollapsed || cmds.length > 1;

  const dimColor = isOwn ? "rgba(255,255,255,0.7)" : "dimmed";
  const cmdColor = isOwn ? "rgba(255,255,255,0.92)" : "magenta.4";
  const countLabel = `Ran ${cmds.length} ${cmds.length === 1 ? "command" : "commands"}`;

  return (
    <Stack gap={0} mb={4}>
      {showToggle && (
        <UnstyledButton onClick={onToggle} style={{ alignSelf: "flex-start" }}>
          <Group gap={4} wrap="nowrap">
            <IconChevronDown
              size={14}
              style={{
                transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform 0.15s",
                color: isOwn
                  ? "rgba(255,255,255,0.7)"
                  : "var(--mantine-color-dimmed)",
              }}
            />
            <Text size="xs" c={dimColor}>
              {countLabel}
            </Text>
          </Group>
        </UnstyledButton>
      )}
      {visible.map((cmd) => {
        const showSpinner = isActive && cmd.logId === latestId;
        const parsed = parseCommandIcon(firstLine(cmd.message));
        return (
          <Tooltip
            key={cmd.logId}
            label={tooltipText(cmd.message)}
            multiline
            w={480}
            openDelay={300}
            withinPortal
            position="top-start"
            styles={{
              tooltip: {
                fontFamily: "monospace",
                fontSize: 11,
                whiteSpace: "pre-wrap",
              },
            }}
          >
            <UnstyledButton
              onClick={() => onCommandClick(cmd)}
              style={{ minWidth: 0, width: "100%" }}
            >
              <Group gap={4} wrap="nowrap" align="center">
                {/* Fixed-width gutter so cmd lines align under the chevron
                    in the "Ran N" toggle above. */}
                <Box
                  w={14}
                  h={14}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <parsed.Icon
                    size={14}
                    color={parsed.color}
                    style={
                      showSpinner
                        ? {
                            animation:
                              "commandIconPulse 1.2s ease-in-out infinite",
                          }
                        : undefined
                    }
                  />
                </Box>
                <Text
                  size="xs"
                  c={cmdColor}
                  style={{
                    fontFamily: "monospace",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {parsed.remainder}
                </Text>
              </Group>
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Stack>
  );
};
