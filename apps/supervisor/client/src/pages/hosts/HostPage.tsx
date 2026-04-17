import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NativeSelect,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { HateoasAction } from "@naisys/common";
import { hasAction, hasActionTemplate } from "@naisys/common";
import type { HostDetailResponse } from "@naisys/supervisor-shared";
import { IconEdit, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useHostDataContext } from "../../contexts/HostDataContext";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";
import {
  assignAgentToHost,
  deleteHost,
  getHostDetail,
  unassignAgentFromHost,
  updateHostApi,
} from "../../lib/apiAgents";

export const HostPage: React.FC = () => {
  const { hostname } = useParams<{ hostname: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { agents } = useAgentDataContext();
  const { hosts } = useHostDataContext();
  const { status: connectionStatus } = useConnectionStatus();

  const [hostDetail, setHostDetail] = useState<HostDetailResponse | null>(null);
  const [actions, setActions] = useState<HateoasAction[] | undefined>();
  const [loading, setLoading] = useState(true);

  // Editable fields
  const [editName, setEditName] = useState("");
  const [editRestricted, setEditRestricted] = useState(false);

  const [nameEditable, setNameEditable] = useState(false);

  // Action states
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");

  const host = hostname ? hosts.find((h) => h.name === hostname) : undefined;

  const fetchDetail = useCallback(async () => {
    if (!hostname) return;
    try {
      const data = await getHostDetail(hostname);
      setHostDetail(data);
      setActions(data._actions);
      setEditName(data.name);
      setEditRestricted(data.restricted);
    } catch (err) {
      console.error("Error fetching host detail:", err);
    } finally {
      setLoading(false);
    }
  }, [hostname]);

  useEffect(() => {
    if (!hostname) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNameEditable(false);
    void fetchDetail();
  }, [hostname, fetchDetail]);

  const hasChanges =
    hostDetail &&
    (editName !== hostDetail.name || editRestricted !== hostDetail.restricted);

  const handleSave = async () => {
    if (!hostname || !hostDetail) return;
    setSaving(true);
    try {
      const updates: { name?: string; restricted?: boolean } = {};
      if (editName !== hostDetail.name) updates.name = editName;
      if (editRestricted !== hostDetail.restricted)
        updates.restricted = editRestricted;

      const result = await updateHostApi(hostname, updates);
      if (result.success) {
        notifications.show({
          title: "Host Updated",
          message: result.message,
          color: "green",
        });
        setNameEditable(false);
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        if (updates.name && updates.name !== hostname) {
          void navigate(`/hosts/${updates.name}`, { replace: true });
        } else {
          void fetchDetail();
        }
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
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!hostDetail) return;
    setEditName(hostDetail.name);
    setEditRestricted(hostDetail.restricted);
    setNameEditable(false);
  };

  const handleDelete = async () => {
    if (!hostname || !host) return;
    const confirmed = window.confirm(
      `Permanently delete host "${host.name}"? This will remove all associated run sessions, logs, and cost records and cannot be undone.`,
    );
    if (!confirmed) return;

    const doubleConfirmed = window.confirm(
      `Are you absolutely sure? All historical data for host "${host.name}" will be permanently deleted.`,
    );
    if (!doubleConfirmed) return;

    setDeleting(true);
    try {
      const result = await deleteHost(hostname);
      if (result.success) {
        notifications.show({
          title: "Host Deleted",
          message: result.message,
          color: "red",
        });
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        void navigate("/hosts");
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

  const handleAssign = async () => {
    if (!hostname || !selectedAgentId) return;
    setAssigning(true);
    try {
      const result = await assignAgentToHost(hostname, Number(selectedAgentId));
      if (result.success) {
        notifications.show({
          title: "Agent Assigned",
          message: result.message,
          color: "green",
        });
        setSelectedAgentId("");
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        void queryClient.invalidateQueries({ queryKey: ["agent-data"] });
        void fetchDetail();
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
      setAssigning(false);
    }
  };

  const handleUnassign = async (agentName: string) => {
    if (!hostname) return;
    try {
      const result = await unassignAgentFromHost(hostname, agentName);
      if (result.success) {
        notifications.show({
          title: "Agent Unassigned",
          message: result.message,
          color: "green",
        });
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        void queryClient.invalidateQueries({ queryKey: ["agent-data"] });
        void fetchDetail();
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
    }
  };

  if (!hostname) {
    return (
      <Stack gap="md">
        <Text c="dimmed" ta="center">
          Select a host from the sidebar
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack gap="md">
        <Text c="dimmed">Loading...</Text>
      </Stack>
    );
  }

  // Active agents: agents currently running on this host (from context)
  const activeAgents = agents.filter(
    (a) => a.status === "active" && a.host === host?.name,
  );

  // Agents available for assignment (not already assigned)
  const assignedAgentIds = new Set(
    hostDetail?.assignedAgents.map((a) => a.id) ?? [],
  );
  const unassignedAgents = agents.filter((a) => !assignedAgentIds.has(a.id));

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" align="center">
          {hasAction(actions, "update") && nameEditable ? (
            <TextInput
              value={editName}
              onChange={(e) => setEditName(e.currentTarget.value)}
              size="lg"
              styles={{ input: { fontWeight: 700 } }}
            />
          ) : (
            <>
              <Title order={2}>{host?.name ?? hostname}</Title>
              {hasAction(actions, "update") && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={() => setNameEditable(true)}
                >
                  <IconEdit size={16} />
                </ActionIcon>
              )}
            </>
          )}
        </Group>
        <Group gap="xs">
          {hasChanges && (
            <>
              <Button color="blue" loading={saving} onClick={handleSave}>
                Save
              </Button>
              <Button variant="default" onClick={handleDiscard}>
                Discard
              </Button>
            </>
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
      </Group>

      {/* Host Details */}
      <Table withRowBorders={false}>
        <Table.Tbody>
          {hostDetail?.hostType && (
            <Table.Tr>
              <Table.Td c="dimmed">Type</Table.Td>
              <Table.Td>
                <Badge
                  size="sm"
                  variant="light"
                  color={
                    hostDetail.hostType === "supervisor" ? "violet" : "blue"
                  }
                >
                  {hostDetail.hostType}
                </Badge>
              </Table.Td>
            </Table.Tr>
          )}
          {connectionStatus === "connected" && (
            <Table.Tr>
              <Table.Td c="dimmed">Status</Table.Td>
              <Table.Td>
                <Badge
                  size="sm"
                  variant="light"
                  color={host?.online ? "green" : "gray"}
                >
                  {host?.online ? "online" : "offline"}
                </Badge>
              </Table.Td>
            </Table.Tr>
          )}
          {(host?.version || hostDetail?.version) && (
            <Table.Tr>
              <Table.Td c="dimmed">Version</Table.Td>
              <Table.Td>{host?.version || hostDetail?.version}</Table.Td>
            </Table.Tr>
          )}
          {hostDetail?.environment && (
            <Table.Tr>
              <Table.Td c="dimmed">Environment</Table.Td>
              <Table.Td>
                {hostDetail.environment.osVersion} ·{" "}
                {hostDetail.environment.shell}
                {hostDetail.environment.arch
                  ? ` · ${hostDetail.environment.arch}`
                  : ""}
                {hostDetail.environment.nodeVersion
                  ? ` · node ${hostDetail.environment.nodeVersion}`
                  : ""}
              </Table.Td>
            </Table.Tr>
          )}
          {hostDetail?.machineId && (
            <Table.Tr>
              <Table.Td c="dimmed">Machine ID</Table.Td>
              <Table.Td>{hostDetail.machineId}</Table.Td>
            </Table.Tr>
          )}
          {hostDetail?.lastIp && (
            <Table.Tr>
              <Table.Td c="dimmed">Last IP</Table.Td>
              <Table.Td>{hostDetail.lastIp}</Table.Td>
            </Table.Tr>
          )}
          {hostDetail?.lastActive && (
            <Table.Tr>
              <Table.Td c="dimmed">Last Active</Table.Td>
              <Table.Td>
                {new Date(hostDetail.lastActive).toLocaleString()}
              </Table.Td>
            </Table.Tr>
          )}
          {hostDetail?.hostType !== "supervisor" && (
            <Table.Tr>
              <Table.Td c="dimmed">Restricted</Table.Td>
              <Table.Td>
                {hasAction(actions, "update") ? (
                  <Switch
                    checked={editRestricted}
                    onChange={(e) => setEditRestricted(e.currentTarget.checked)}
                    label="Only assigned agents can run on this host"
                    size="sm"
                  />
                ) : (
                  <Badge
                    size="sm"
                    variant="light"
                    color={host?.restricted ? "orange" : "gray"}
                  >
                    {host?.restricted ? "Yes" : "No"}
                  </Badge>
                )}
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {/* Active Agents — not applicable for supervisor hosts */}
      {hostDetail?.hostType !== "supervisor" && (
        <>
          <Title order={4}>Active Agents</Title>
          {activeAgents.length === 0 ? (
            <Text c="dimmed" size="sm">
              No agents currently active on this host
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Username</Table.Th>
                  <Table.Th>Title</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {activeAgents.map((agent) => (
                  <Table.Tr
                    key={agent.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/agents/${agent.name}`)}
                  >
                    <Table.Td>{agent.name}</Table.Td>
                    <Table.Td>{agent.title}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          {/* Assigned Agents */}
          <Title order={4}>Assigned Agents</Title>
          {hostDetail && hostDetail.assignedAgents.length === 0 ? (
            <Text c="dimmed" size="sm">
              No agents assigned (any agent can use this host)
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Username</Table.Th>
                  <Table.Th>Title</Table.Th>
                  {hasAction(actions, "assign-agent") && (
                    <Table.Th style={{ width: 50 }}></Table.Th>
                  )}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {hostDetail?.assignedAgents.map((agent) => (
                  <Table.Tr
                    key={agent.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/agents/${agent.name}`)}
                  >
                    <Table.Td>{agent.name}</Table.Td>
                    <Table.Td>{agent.title}</Table.Td>
                    {hasActionTemplate(
                      hostDetail?._actionTemplates,
                      "unassignAgent",
                    ) && (
                      <Table.Td>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleUnassign(agent.name);
                          }}
                        >
                          <IconX size={14} />
                        </Button>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}

          {/* Assign agent form */}
          {hasAction(actions, "assign-agent") && (
            <Group gap="xs">
              <NativeSelect
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.currentTarget.value)}
                data={[
                  { value: "", label: "Select agent..." },
                  ...unassignedAgents.map((a) => ({
                    value: String(a.id),
                    label: `${a.name} — ${a.title}`,
                  })),
                ]}
                style={{ flex: 1, maxWidth: 300 }}
              />
              <Button
                leftSection={<IconPlus size={16} />}
                loading={assigning}
                disabled={!selectedAgentId}
                onClick={handleAssign}
              >
                Assign
              </Button>
            </Group>
          )}
        </>
      )}
    </Stack>
  );
};
