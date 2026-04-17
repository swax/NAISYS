import { ActionIcon, Group, Text } from "@mantine/core";
import { IconArrowsLeftRight } from "@tabler/icons-react";
import React from "react";

import type { Agent } from "../types/agent";
import { AgentModelIcon } from "./AgentModelIcon";

interface ParticipantInfoProps {
  names: string[];
  agents: Agent[];
  onSwitch?: (name: string) => void;
}

function statusColor(status: Agent["status"] | undefined): string {
  switch (status) {
    case "active":
      return "var(--mantine-color-green-6)";
    case "available":
      return "var(--mantine-color-yellow-6)";
    case "suspended":
      return "var(--mantine-color-red-6)";
    default:
      return "var(--mantine-color-gray-6)";
  }
}

export const ParticipantInfo: React.FC<ParticipantInfoProps> = ({
  names,
  agents,
  onSwitch,
}) => {
  return (
    <Group gap="md" wrap="wrap">
      {names.map((name) => {
        const a = agents.find((ag) => ag.name === name);
        return (
          <Group key={name} gap={6} wrap="nowrap">
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: statusColor(a?.status),
                flexShrink: 0,
              }}
              title={a?.status ?? "unknown"}
            />
            <AgentModelIcon
              shellModel={a?.shellModel}
              size={14}
              style={{ flexShrink: 0 }}
            />
            <Text size="sm" fw={600}>
              {name}
            </Text>
            {a?.title && (
              <Text size="sm" c="dimmed">
                ({a.title})
              </Text>
            )}
            {onSwitch && (
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSwitch(name);
                }}
                title={`View from ${name}'s perspective`}
              >
                <IconArrowsLeftRight size={14} />
              </ActionIcon>
            )}
          </Group>
        );
      })}
    </Group>
  );
};
