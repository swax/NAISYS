import { Stack, Text } from "@mantine/core";
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useAgentDataContext } from "../../contexts/AgentDataContext";

export const AgentIndex: React.FC = () => {
  const { agents } = useAgentDataContext();
  const navigate = useNavigate();

  useEffect(() => {
    const firstActive = agents.find((a) => !a.archived);
    if (firstActive) {
      navigate(`/agents/${firstActive.id}`, { replace: true });
    }
  }, [agents, navigate]);

  return (
    <Stack gap="md">
      <Text c="dimmed" ta="center">
        Select an agent from the sidebar
      </Text>
    </Stack>
  );
};
