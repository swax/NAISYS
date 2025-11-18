import {
  Alert,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconEdit,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { GetAgentConfigResponse } from "shared";

export const Controls: React.FC = () => {
  const { agent } = useParams<{ agent: string }>();
  const [config, setConfig] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) {
      setLoading(false);
      return;
    }

    const fetchConfig = async () => {
      try {
        const response = await fetch(
          `/api/controls/agent-config?username=${encodeURIComponent(agent)}`,
        );
        const data: GetAgentConfigResponse = await response.json();

        if (data.success && data.config) {
          setConfig(data.config);
        } else {
          setError(data.message || "Failed to load configuration");
        }
      } catch (err) {
        console.error("Error fetching agent config:", err);
        setError("An error occurred while loading the configuration");
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [agent]);

  if (!agent) {
    return <Text size="xl">Controls</Text>;
  }

  if (loading) {
    return (
      <Stack align="center" p="xl">
        <Loader size="lg" />
        <Text>Loading configuration...</Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack p="md">
        <Text size="xl">Controls for {agent}</Text>
        <Alert color="red" title="Error">
          {error}
        </Alert>
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
        <Divider orientation="vertical" />
        <Button color="blue" disabled leftSection={<IconEdit size={16} />}>
          Edit Config
        </Button>
      </Group>

      <Code block>{config}</Code>
    </Stack>
  );
};
