import { ActionIcon, Box, Group, Text, Tooltip } from "@mantine/core";
import { IconTerminal2 } from "@tabler/icons-react";
import React from "react";

import type { RunDivider } from "../lib/threadRunDividers";

interface RunDividerLineProps {
  divider: RunDivider;
  currentAgentUsername: string;
  loadedRunIds?: Set<number>;
  onLoadCommands?: (runIds: number[]) => void;
}

/** One row per user with start/stop in this gap, aligned to that user's side. */
export const RunDividerLine: React.FC<RunDividerLineProps> = ({
  divider,
  currentAgentUsername,
  loadedRunIds,
  onLoadCommands,
}) => {
  return (
    <Box my={4}>
      {divider.perUser.map((entry) => {
        const isOwn = entry.username === currentAgentUsername;
        const verb = entry.type === "start" ? "started" : "stopped";
        const unloadedRunIds = loadedRunIds
          ? entry.runIds.filter((id) => !loadedRunIds.has(id))
          : [];
        const showLoadButton =
          entry.type === "start" &&
          onLoadCommands &&
          unloadedRunIds.length > 0;

        return (
          <Box
            key={`${entry.username}:${entry.type}:${entry.time}`}
            style={{
              display: "flex",
              justifyContent: isOwn ? "flex-end" : "flex-start",
            }}
          >
            <Group gap={4} wrap="nowrap" align="center">
              <Text size="xs" c="dimmed">
                {entry.username} {verb} · {formatTime(entry.time)}
              </Text>
              {showLoadButton && (
                <Tooltip label="Load commands" openDelay={200}>
                  <ActionIcon
                    variant="subtle"
                    color="blue"
                    size="xs"
                    onClick={() => onLoadCommands(unloadedRunIds)}
                    aria-label="Load commands"
                  >
                    <IconTerminal2 size={12} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Box>
        );
      })}
    </Box>
  );
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
