import { Button, Code, Group, Loader, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { hasAction, type HateoasAction } from "@naisys/common";
import {
  IconArchive,
  IconArchiveOff,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import {
  archiveAgent,
  deleteAgentPermanently,
  getAgentDetail,
  startAgent,
  stopAgent,
  unarchiveAgent,
} from "../../lib/apiAgents";

export const AgentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agents } = useAgentDataContext();

  const agentId = id ? Number(id) : null;
  const agentData = agents.find((a) => a.id === agentId);
  const [config, setConfig] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [actions, setActions] = useState<HateoasAction[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchDetail = async () => {
    if (!agentId) return;
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

  useEffect(() => {
    if (!agentId) {
      setLoading(false);
      return;
    }

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
        await fetchDetail();
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

    if (agentData?.name === "admin") {
      const confirmed = window.confirm(
        "The admin agent keeps the NAISYS process running when all other agents are stopped. " +
          "Stopping it may end the process. Are you sure?",
      );
      if (!confirmed) return;
    }

    setStopping(true);
    try {
      const result = await stopAgent(agentId);
      if (result.success) {
        notifications.show({
          title: "Agent Stopped",
          message: result.message,
          color: "green",
        });
        await fetchDetail();
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

  const handleArchive = async () => {
    if (!agentId) return;
    const confirmed = window.confirm(
      `Archive agent "${agentData?.name}"? It will be hidden from the main list but can still be edited.`,
    );
    if (!confirmed) return;

    setArchiving(true);
    try {
      const result = await archiveAgent(agentId);
      if (result.success) {
        notifications.show({
          title: "Agent Archived",
          message: result.message,
          color: "orange",
        });
        await fetchDetail();
      } else {
        notifications.show({
          title: "Archive Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Archive Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setArchiving(false);
    }
  };

  const handleUnarchive = async () => {
    if (!agentId) return;
    setArchiving(true);
    try {
      const result = await unarchiveAgent(agentId);
      if (result.success) {
        notifications.show({
          title: "Agent Unarchived",
          message: result.message,
          color: "teal",
        });
        await fetchDetail();
      } else {
        notifications.show({
          title: "Unarchive Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Unarchive Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setArchiving(false);
    }
  };

  const handleDelete = async () => {
    if (!agentId) return;
    const confirmed = window.confirm(
      `Permanently delete agent "${agentData?.name}"? This will remove all associated data and cannot be undone.`,
    );
    if (!confirmed) return;

    const doubleConfirmed = window.confirm(
      `Are you absolutely sure? All runs, logs, costs, and mail records for "${agentData?.name}" will be permanently deleted.`,
    );
    if (!doubleConfirmed) return;

    setDeleting(true);
    try {
      const result = await deleteAgentPermanently(agentId);
      if (result.success) {
        notifications.show({
          title: "Agent Deleted",
          message: result.message,
          color: "red",
        });
        navigate("/agents");
      } else {
        notifications.show({
          title: "Delete Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Delete Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setDeleting(false);
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

      <Group>
        <Text fw={500}>Lifecycle:</Text>
        {hasAction(actions, "archive") && (
          <Button
            color="orange"
            loading={archiving}
            leftSection={<IconArchive size={16} />}
            onClick={handleArchive}
          >
            Archive
          </Button>
        )}
        {hasAction(actions, "unarchive") && (
          <Button
            color="teal"
            loading={archiving}
            leftSection={<IconArchiveOff size={16} />}
            onClick={handleUnarchive}
          >
            Unarchive
          </Button>
        )}
        {hasAction(actions, "delete") && (
          <Button
            color="red"
            variant="outline"
            loading={deleting}
            leftSection={<IconTrash size={16} />}
            onClick={handleDelete}
          >
            Delete
          </Button>
        )}
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
