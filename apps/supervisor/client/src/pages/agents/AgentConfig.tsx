import type { AgentConfigFile, HateoasAction } from "@naisys/common";
import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { IconEdit } from "@tabler/icons-react";
import React, { useCallback, useEffect, useState } from "react";
import { useBlocker, useParams } from "react-router-dom";
import { AgentConfigForm } from "./AgentConfigForm";
import { hasAction } from "@naisys/common";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { getAgentConfig, updateAgentConfig } from "../../lib/apiAgents";
import { api, apiEndpoints, type ModelsResponse } from "../../lib/apiClient";

export const AgentConfig: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { agents } = useAgentDataContext();

  const agentId = id ? Number(id) : null;
  const agentData = agents.find((a) => a.id === agentId);
  const [config, setConfig] = useState<AgentConfigFile | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [llmModelOptions, setLlmModelOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [imageModelOptions, setImageModelOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [actions, setActions] = useState<HateoasAction[] | undefined>();

  // Block in-app navigation while editing
  const blocker = useBlocker(isEditing);

  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("You have unsaved changes. Leave this page?")) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker]);

  // Block browser refresh/close while editing
  const handleBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (isEditing) {
        e.preventDefault();
      }
    },
    [isEditing],
  );

  useEffect(() => {
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [handleBeforeUnload]);

  useEffect(() => {
    api
      .get<ModelsResponse>(apiEndpoints.models)
      .then((data) => {
        setLlmModelOptions(data.llmModels);
        setImageModelOptions(data.imageModels);
      })
      .catch(() => {
        // Fall back to static options (already set as defaults)
      });
  }, []);

  useEffect(() => {
    if (!agentId) {
      setLoading(false);
      return;
    }

    const fetchConfig = async () => {
      try {
        const data = await getAgentConfig(agentId);
        setConfig(data.config);
        setActions(data._actions);
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
        {!isEditing && hasAction(actions, "update") && (
          <Button
            color="blue"
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
          llmModelOptions={llmModelOptions}
          imageModelOptions={imageModelOptions}
          readOnly={!isEditing}
          saving={saving}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </Stack>
  );
};
