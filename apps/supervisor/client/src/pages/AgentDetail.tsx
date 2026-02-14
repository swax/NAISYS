import {
  Button,
  Code,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../contexts/AgentDataContext";
import { getAgentDetail } from "../lib/apiClient";

export const AgentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { agents } = useAgentDataContext();

  const agentId = id ? Number(id) : null;
  const agentData = agents.find((a) => a.id === agentId);
  const [config, setConfig] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) {
      setLoading(false);
      return;
    }

    const fetchDetail = async () => {
      try {
        const data = await getAgentDetail(agentId);
        setConfig(data.config);
        setConfigPath(data.configPath || null);
      } catch (err) {
        console.error("Error fetching agent detail:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [agentId]);

  if (!agentId) {
    return <Text size="xl">Agent Detail</Text>;
  }

  if (loading) {
    return (
      <Stack align="center" p="xl">
        <Loader size="lg" />
        <Text>Loading...</Text>
      </Stack>
    );
  }

  return (
    <Stack p="md">
      <Group>
        <Text fw={500}>Force Agent:</Text>
        <Button
          color="green"
          disabled
          leftSection={<IconPlayerPlay size={16} />}
        >
          Start
        </Button>
        <Button
          color="yellow"
          disabled
          leftSection={<IconPlayerPause size={16} />}
        >
          Pause
        </Button>
        <Button color="red" disabled leftSection={<IconPlayerStop size={16} />}>
          Stop
        </Button>
      </Group>

      {configPath && (
        <Text size="sm" c="dimmed">
          {agentData?.name}@{agentData?.host}:{configPath}
        </Text>
      )}

      {config && (
        <Code block style={{ whiteSpace: "pre-wrap" }}>
          {config}
        </Code>
      )}
    </Stack>
  );
};
