import {
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
import { hasAction } from "@naisys/common";
import type { HateoasAction } from "@naisys/common";
import type { HostDetailResponse } from "@naisys-supervisor/shared";
import { IconPlus, IconTrash, IconX } from "@tabler/icons-react";
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
  const { id } = useParams<{ id: string }>();
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

  // Action states
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");

  const hostId = id ? Number(id) : null;
  const host = hosts.find((h) => h.id === hostId);

  const fetchDetail = useCallback(async () => {
    if (!hostId) return;
    try {
      const data = await getHostDetail(hostId);
      setHostDetail(data);
      setActions(data._actions);
      setEditName(data.name);
      setEditRestricted(data.restricted);
    } catch (err) {
      console.error("Error fetching host detail:", err);
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    if (!hostId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchDetail();
  }, [hostId, fetchDetail]);

  const hasChanges =
    hostDetail &&
    (editName !== hostDetail.name || editRestricted !== hostDetail.restricted);

  const handleSave = async () => {
    if (!hostId || !hostDetail) return;
    setSaving(true);
    try {
      const updates: { name?: string; restricted?: boolean } = {};
      if (editName !== hostDetail.name) updates.name = editName;
      if (editRestricted !== hostDetail.restricted)
        updates.restricted = editRestricted;

      const result = await updateHostApi(hostId, updates);
      if (result.success) {
        notifications.show({
          title: "Host Updated",
          message: result.message,
          color: "green",
        });
        void queryClient.invalidateQueries({ queryKey: ["host-data"] });
        void fetchDetail();
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
  };

  const handleDelete = async () => {
    if (!hostId || !host) return;
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
      const result = await deleteHost(hostId);
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
    if (!hostId || !selectedAgentId) return;
    setAssigning(true);
    try {
      const result = await assignAgentToHost(hostId, Number(selectedAgentId));
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

  const handleUnassign = async (agentId: number) => {
    if (!hostId) return;
    try {
      const result = await unassignAgentFromHost(hostId, agentId);
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

  if (!hostId) {
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
          {hasAction(actions, "update") ? (
            <TextInput
              value={editName}
              onChange={(e) => setEditName(e.currentTarget.value)}
              size="lg"
              styles={{ input: { fontWeight: 700 } }}
            />
          ) : (
            <Title order={2}>{host?.name ?? `Host ${hostId}`}</Title>
          )}
          {connectionStatus === "connected" && (
            <Badge
              size="lg"
              variant="light"
              color={host?.online ? "green" : "gray"}
            >
              {host?.online ? "online" : "offline"}
            </Badge>
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

      {/* Restricted toggle */}
      {hasAction(actions, "update") && (
        <Switch
          label="Restricted"
          description="Only assigned agents can run on this host"
          checked={editRestricted}
          onChange={(e) => setEditRestricted(e.currentTarget.checked)}
        />
      )}
      {!hasAction(actions, "update") && host?.restricted && (
        <Badge size="sm" variant="light" color="orange">
          Restricted
        </Badge>
      )}

      {/* Active Agents */}
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
                onClick={() => navigate(`/agents/${agent.id}`)}
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
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <Table.Td>{agent.name}</Table.Td>
                <Table.Td>{agent.title}</Table.Td>
                {hasAction(agent._actions, "unassign") && (
                  <Table.Td>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleUnassign(agent.id);
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
    </Stack>
  );
};
