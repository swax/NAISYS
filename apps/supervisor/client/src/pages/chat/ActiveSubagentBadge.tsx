import { Group, Text } from "@mantine/core";
import { IconHierarchy2 } from "@tabler/icons-react";
import React from "react";

interface ActiveSubagentBadgeProps {
  count: number;
  isOwn: boolean;
}

export const ActiveSubagentBadge: React.FC<ActiveSubagentBadgeProps> = ({
  count,
  isOwn,
}) => {
  if (count === 0) return null;
  // Icon stroke takes a literal color, not a Mantine palette token —
  // "magenta.4" works on Text but the icon would render invisible.
  const color = isOwn ? "rgba(255,255,255,0.85)" : "magenta";
  return (
    <Group gap={4} wrap="nowrap" mb={4} style={{ alignSelf: "flex-start" }}>
      <IconHierarchy2
        size={14}
        color={color}
        style={{
          animation: "commandIconPulse 1.2s ease-in-out infinite",
          flexShrink: 0,
        }}
      />
      <Text
        size="xs"
        c={isOwn ? "rgba(255,255,255,0.85)" : "magenta.4"}
        fw={500}
      >
        {count} subagent{count === 1 ? "" : "s"} running
      </Text>
    </Group>
  );
};
