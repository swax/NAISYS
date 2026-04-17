import {
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { AgentConfigFile, HateoasAction } from "@naisys/common";
import { hasAction } from "@naisys/common";
import { IconFileExport, IconFileImport } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useHostDataContext } from "../../contexts/HostDataContext";
import {
  assignAgentToHost,
  getAgentConfig,
  setAgentLead,
  unassignAgentFromHost,
  updateAgentConfig,
} from "../../lib/apiAgents";
import { api, apiEndpoints, type ModelsResponse } from "../../lib/apiClient";
import { AgentConfigForm } from "./AgentConfigForm";
import { ConfigYamlDialog } from "./ConfigYamlDialog";

export const AgentConfig: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const { agents } = useAgentDataContext();
  const { hosts } = useHostDataContext();
  const queryClient = useQueryClient();

  const agentData = username ? agents.find((a) => a.name === username) : null;
  const [config, setConfig] = useState<AgentConfigFile | null>(null);
  const [assignedHosts, setAssignedHosts] = useState<
    { id: number; name: string }[] | undefined
  >();
  const [hostActionInProgress, setHostActionInProgress] = useState(false);
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
  const [configRevision, setConfigRevision] = useState(0);
  const [configDialogMode, setConfigDialogMode] = useState<
    "import" | "export" | null
  >(null);
  const [settingLead, setSettingLead] = useState(false);

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

  const fetchConfig = useCallback(async () => {
    if (!username) {
      setLoading(false);
      return;
    }

    try {
      const data = await getAgentConfig(username);
      setConfig(data.config);
      setAssignedHosts(data.assignedHosts ?? []);
      setActions(data._actions);
      setConfigRevision((r) => r + 1);
    } catch (err) {
      console.error("Error fetching agent config:", err);
      setError("An error occurred while loading the configuration");
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleSave = async (updatedConfig: AgentConfigFile) => {
    if (!username) return;

    setSaving(true);
    setSaveError(null);

    try {
      const data = await updateAgentConfig(username, updatedConfig);

      if (data.success) {
        setConfig(updatedConfig);
        setConfigRevision((r) => r + 1);
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

  const handleSetLead = async (value: string | null) => {
    if (!username) return;
    setSettingLead(true);
    try {
      const result = await setAgentLead(username, value);
      if (result.success) {
        notifications.show({
          title: "Lead Agent Updated",
          message: result.message,
          color: "green",
        });
      } else {
        notifications.show({
          title: "Update Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Update Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setSettingLead(false);
    }
  };

  const agentId = agentData?.id;

  const handleAssignHost = async (hostname: string) => {
    if (!agentId) return;
    setHostActionInProgress(true);
    try {
      const result = await assignAgentToHost(hostname, agentId);
      if (result.success) {
        notifications.show({
          title: "Host Assigned",
          message: result.message,
          color: "green",
        });
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        void queryClient.invalidateQueries({ queryKey: ["agent-data"] });
        await fetchConfig();
      } else {
        notifications.show({
          title: "Assign Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Assign Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setHostActionInProgress(false);
    }
  };

  const handleUnassignHost = async (hostname: string) => {
    if (!username) return;
    setHostActionInProgress(true);
    try {
      const result = await unassignAgentFromHost(hostname, username);
      if (result.success) {
        notifications.show({
          title: "Host Unassigned",
          message: result.message,
          color: "green",
        });
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        void queryClient.invalidateQueries({ queryKey: ["agent-data"] });
        await fetchConfig();
      } else {
        notifications.show({
          title: "Unassign Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Unassign Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setHostActionInProgress(false);
    }
  };

  const leadAgentOptions = agents
    .filter((a) => a.name !== username && !a.archived)
    .map((a) => ({
      value: a.name,
      label: a.title ? `${a.name} (${a.title})` : a.name,
    }));

  const currentLeadValue = agentData?.leadUsername;

  if (!username) {
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
        <Text size="xl">{agentData?.name || username}</Text>
        <Alert color="red" title="Error">
          {error}
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack p="md" maw={1000}>
      <Group>
        {hasAction(actions, "export-config") && (
          <Button
            variant="outline"
            leftSection={<IconFileExport size={16} />}
            onClick={() => setConfigDialogMode("export")}
          >
            Export
          </Button>
        )}
        {hasAction(actions, "import-config") && (
          <Button
            variant="outline"
            leftSection={<IconFileImport size={16} />}
            onClick={() => setConfigDialogMode("import")}
          >
            Import
          </Button>
        )}
      </Group>

      {hasAction(actions, "update") && (
        <Select
          label="Lead Agent"
          placeholder="None (top-level agent)"
          data={leadAgentOptions}
          value={currentLeadValue ?? null}
          onChange={handleSetLead}
          clearable
          searchable
          disabled={settingLead}
          maw={300}
        />
      )}

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
          key={configRevision}
          config={config}
          llmModelOptions={llmModelOptions}
          imageModelOptions={imageModelOptions}
          saving={saving}
          onSave={handleSave}
          assignedHosts={assignedHosts}
          availableHosts={hosts.map((h) => ({ id: h.id, name: h.name }))}
          hostActionInProgress={hostActionInProgress}
          onAssignHost={
            hasAction(actions, "update") ? handleAssignHost : undefined
          }
          onUnassignHost={
            hasAction(actions, "update") ? handleUnassignHost : undefined
          }
        />
      )}

      {username && configDialogMode && (
        <ConfigYamlDialog
          agentUsername={username}
          mode={configDialogMode}
          opened={true}
          onClose={() => setConfigDialogMode(null)}
          onSuccess={fetchConfig}
        />
      )}
    </Stack>
  );
};
