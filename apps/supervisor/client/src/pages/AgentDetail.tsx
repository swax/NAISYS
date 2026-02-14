import {
  Button,
  Code,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { hasAction, type HateoasAction } from "@naisys/common";
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../contexts/AgentDataContext";
import { getAgentDetail, startAgent, stopAgent } from "../lib/apiClient";

export const AgentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { agents } = useAgentDataContext();

  const agentId = id ? Number(id) : null;
  const agentData = agents.find((a) => a.id === agentId);
  const [config, setConfig] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [actions, setActions] = useState<HateoasAction[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

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
        setActions(data._actions);
      } catch (err) {
        console.error("Error fetching agent detail:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [agentId]);

  const handleStart = async () => {
    if (!agentId) return;
    setStarting(true);
    try {
      const result = await startAgent(agentId);
      if (result.success) {
        notifications.show({
          title: "Agent Started",
          message: result.hostname
            ? `Agent started on ${result.hostname}`
            : "Agent started",
          color: "green",
        });
      } else {
        notifications.show({
          title: "Start Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Start Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!agentId) return;
    setStopping(true);
    try {
      const result = await stopAgent(agentId);
      if (result.success) {
        notifications.show({
          title: "Agent Stopped",
          message: result.message,
          color: "green",
        });
      } else {
        notifications.show({
          title: "Stop Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Stop Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setStopping(false);
    }
  };

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
          disabled={!hasAction(actions, "start")}
          loading={starting}
          leftSection={<IconPlayerPlay size={16} />}
          onClick={handleStart}
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
        <Button
          color="red"
          disabled={!hasAction(actions, "stop")}
          loading={stopping}
          leftSection={<IconPlayerStop size={16} />}
          onClick={handleStop}
        >
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
