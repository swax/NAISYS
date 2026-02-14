import type { AgentConfigFile } from "@naisys/common";
import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { IconEdit } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AgentConfigForm } from "../../components/AgentConfigForm";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useSession } from "../../contexts/SessionContext";
import { getAgentConfig, updateAgentConfig } from "../../lib/apiAgents";

export const AgentConfig: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated } = useSession();
  const { agents } = useAgentDataContext();

  const agentId = id ? Number(id) : null;
  const agentData = agents.find((a) => a.id === agentId);
  const [config, setConfig] = useState<AgentConfigFile | null>(null);
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
        const data = await getAgentConfig(agentId);
        setConfig(data.config);
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
      setIsEditing(true);
      setSaveError(null);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setSaveError(null);
  };

  const handleSave = async (updatedConfig: AgentConfigFile) => {
    if (!agentId) return;

    setSaving(true);
    setSaveError(null);

    try {
      const data = await updateAgentConfig(agentId, updatedConfig);

      if (data.success) {
        setConfig(updatedConfig);
        setIsEditing(false);
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
    return <Text size="xl">Agent Config</Text>;
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
        {!isEditing && (
          <Button
            color="blue"
            disabled={!isAuthenticated}
            leftSection={<IconEdit size={16} />}
            onClick={handleEdit}
          >
            Edit Config
          </Button>
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

      {config && (
        <AgentConfigForm
          key={isEditing ? "edit" : "view"}
          config={config}
          readOnly={!isEditing}
          saving={saving}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </Stack>
  );
};
