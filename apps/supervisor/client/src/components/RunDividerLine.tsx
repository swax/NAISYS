import { Divider, Text } from "@mantine/core";
import React from "react";

import type { RunDivider } from "../lib/threadRunDividers";

interface RunDividerLineProps {
  divider: RunDivider;
}

export const RunDividerLine: React.FC<RunDividerLineProps> = ({ divider }) => {
  const label = divider.perUser
    .map(
      (e) =>
        `${e.username} ${e.type === "start" ? "started" : "stopped"} · ${formatTime(e.time)}`,
    )
    .join("  ·  ");

  return (
    <Divider
      my={6}
      color="dark.4"
      label={
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      }
      labelPosition="center"
    />
  );
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
