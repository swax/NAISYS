import { Alert, Stack, Text } from "@mantine/core";
import React from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";

export const AgentChat: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { agents } = useAgentDataContext();

  const agentId = id ? Number(id) : 0;
  const agent = agents.find((a) => a.id === agentId);

  if (!id) {
    return (
      <Stack gap="md">
        <Text size="xl" fw={600}>
          Chat
        </Text>
        <Text c="dimmed" ta="center">
          Select an agent from the sidebar to view their chat
        </Text>
      </Stack>
    );
  }

  if (!agent) {
    return (
      <Alert color="yellow" title="Agent not found">
        Agent with ID {id} not found
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <Text c="dimmed" ta="center">
        Chat for {agent.name} coming soon
      </Text>
    </Stack>
  );
};
