import { ActionIcon, Anchor, Group } from "@mantine/core";
import { IconArrowsLeftRight } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { formatAgentLabel } from "../../lib/agentLabel";
import type { Agent } from "../../types/agent";
import { AgentModelIcon } from "../badges/AgentModelIcon";
import { getAgentStatusCssColor } from "../badges/agentStatusColor";

interface ParticipantInfoProps {
  names: string[];
  agents: Agent[];
  onSwitch?: (name: string) => void;
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
            <AgentModelIcon
              shellModel={a?.shellModel}
              size={14}
              style={{ flexShrink: 0 }}
            />
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: getAgentStatusCssColor(a?.status),
                flexShrink: 0,
              }}
              title={a?.status ?? "unknown"}
            />
            <Anchor
              component={Link}
              to={`/agents/${name}`}
              size="sm"
              fw={600}
              c="inherit"
              underline="hover"
            >
              {formatAgentLabel(name, a?.title)}
            </Anchor>
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
