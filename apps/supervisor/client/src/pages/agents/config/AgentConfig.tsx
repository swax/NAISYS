import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useSessionStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import type { AgentConfigFile, HateoasAction } from "@naisys/common";
import { ADMIN_USERNAME, hasAction } from "@naisys/common";
import { IconFileExport, IconFileImport } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { useAgentDataContext } from "../../../contexts/AgentDataContext";
import { useHostDataContext } from "../../../contexts/HostDataContext";
import {
  assignAgentToHost,
  getAgentConfig,
  setAgentLead,
  unassignAgentFromHost,
  updateAgentConfig,
} from "../../../lib/api/apiAgents";
import {
  api,
  apiEndpoints,
  type ModelsResponse,
} from "../../../lib/api/apiClient";
import { AdminConfigForm } from "./AdminConfigForm";
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
  const [hubTimezone, setHubTimezone] = useState<string>("UTC");
  const [configRevision, setConfigRevision] = useState(0);
  const [configDialogMode, setConfigDialogMode] = useState<
    "import" | "export" | null
  >(null);
  const [settingLead, setSettingLead] = useState(false);
  // Backed by sessionStorage so expanded panels persist across the per-agent
  // layout remount (AgentsLayout keys its Outlet on :username).
  const [expandedPanels, setExpandedPanels] = useSessionStorage<string[]>({
    key: "agent-config-expanded-panels",
    defaultValue: [],
    getInitialValueInEffect: false,
  });

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
      setHubTimezone(data.hubTimezone);
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

  // Agents this one's schedules can be initiated by. Self is excluded — a
  // schedule reporting back to its own agent is a no-op.
  const initiatorOptions = leadAgentOptions;

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
    <Box
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        position: "relative",
      }}
    >
      <Stack p="md" maw={1000}>
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

        {config && username === ADMIN_USERNAME && (
          <Stack gap="md">
            <Alert color="blue" title="Admin diagnostic console">
              The admin user is NAISYS&apos;s built-in diagnostic console — a
              no-model agent that runs on every host. Only the settings that
              apply to a console are shown here; LLM-loop settings (shell
              model, schedules, continuity, …) don&apos;t apply to it and are
              managed by NAISYS.
            </Alert>
            <AdminConfigForm
              key={configRevision}
              config={config}
              imageModelOptions={imageModelOptions}
              saving={saving}
              onSave={handleSave}
            />
          </Stack>
        )}

        {config && username !== ADMIN_USERNAME && (
          <AgentConfigForm
            key={configRevision}
            config={config}
            username={username}
            expandedPanels={expandedPanels}
            onExpandedPanelsChange={setExpandedPanels}
            llmModelOptions={llmModelOptions}
            imageModelOptions={imageModelOptions}
            hubTimezone={hubTimezone}
            initiatorOptions={initiatorOptions}
            saving={saving}
            onSave={handleSave}
            assignedHosts={assignedHosts ?? []}
            availableHosts={hosts.map((h) => ({ id: h.id, name: h.name }))}
            hostActionInProgress={hostActionInProgress}
            onAssignHost={
              hasAction(actions, "update") ? handleAssignHost : undefined
            }
            onUnassignHost={
              hasAction(actions, "update") ? handleUnassignHost : undefined
            }
            afterTitle={
              hasAction(actions, "update") ? (
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
              ) : undefined
            }
            advancedExtras={
              hasAction(actions, "export-config") ||
              hasAction(actions, "import-config") ? (
                <>
                  <Text fw={600} size="sm" c="dimmed">
                    Configuration File
                  </Text>
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
                </>
              ) : undefined
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
    </Box>
  );
};
