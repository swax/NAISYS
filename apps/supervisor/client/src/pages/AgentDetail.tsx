import {
  Alert,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import {
  IconCheck,
  IconEdit,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconX,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../contexts/AgentDataContext";
import { useSession } from "../contexts/SessionContext";
import { getAgentDetail, updateAgentConfig } from "../lib/apiClient";

export const AgentDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useSession();
  const { agents } = useAgentDataContext();

  const agentId = id ? Number(id) : null;
  const agentData = agents.find((a) => a.id === agentId);
  const [config, setConfig] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [editedConfig, setEditedConfig] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) {
      setLoading(false);
      return;
    }

    const fetchConfig = async () => {
      try {
        const data = await getAgentDetail(agentId);

        setConfig(data.config);
        setConfigPath(data.configPath || null);
      } catch (err) {
        console.error("Error fetching agent config:", err);
        setError("An error occurred while loading the configuration");
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [agentId]);

  const handleEdit = () => {
    if (config) {
      setEditedConfig(config);
      setIsEditing(true);
      setSaveError(null);
    }
  };

  const handleDiscard = () => {
    setIsEditing(false);
    setEditedConfig("");
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!agentId) return;

    setSaving(true);
    setSaveError(null);

    try {
      const data = await updateAgentConfig(agentId, editedConfig);

      if (data.success) {
        setConfig(editedConfig);
        setIsEditing(false);
        setEditedConfig("");
      } else {
        setSaveError(data.message || "Failed to save configuration");
      }
    } catch (err) {
      console.error("Error saving agent config:", err);
      setSaveError("An error occurred while saving the configuration");
    } finally {
      setSaving(false);
    }
  };

  if (!agentId) {
    return <Text size="xl">Agent Detail</Text>;
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
        <Text size="xl">{agentData?.name || `Agent ${agentId}`}</Text>
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
        {!isEditing ? (
          <Button
            color="blue"
            disabled={!isAuthenticated}
            leftSection={<IconEdit size={16} />}
            onClick={handleEdit}
          >
            Edit Config
          </Button>
        ) : (
          <>
            <Button
              color="green"
              leftSection={<IconCheck size={16} />}
              onClick={handleSave}
              loading={saving}
              disabled={saving}
            >
              Save
            </Button>
            <Button
              color="gray"
              leftSection={<IconX size={16} />}
              onClick={handleDiscard}
              disabled={saving}
            >
              Discard
            </Button>
          </>
        )}
      </Group>

      {saveError && (
        <Alert
          color="red"
          title="Error"
          onClose={() => setSaveError(null)}
          withCloseButton
        >
          {saveError}
        </Alert>
      )}

      {configPath && (
        <Text size="sm" c="dimmed">
          {agentData?.name}@{agentData?.host}:{configPath}
        </Text>
      )}

      {isEditing ? (
        <Textarea
          value={editedConfig}
          onChange={(e) => setEditedConfig(e.target.value)}
          minRows={20}
          autosize
          styles={{
            input: {
              fontFamily: "monospace",
              fontSize: "0.875rem",
            },
          }}
        />
      ) : (
        <Code block>{config}</Code>
      )}
    </Stack>
  );
};
