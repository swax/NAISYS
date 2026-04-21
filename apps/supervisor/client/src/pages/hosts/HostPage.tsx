import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Menu,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { HateoasAction } from "@naisys/common";
import { formatVersion, hasAction, hasActionTemplate } from "@naisys/common";
import { VersionBadge } from "@naisys/common-browser";
import type { HostDetailResponse } from "@naisys/supervisor-shared";
import { IconEdit, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AgentModelIcon } from "../../components/AgentModelIcon";
import { PlatformBadge } from "../../components/PlatformBadge";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useHostDataContext } from "../../contexts/HostDataContext";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";
import { useHostRuns } from "../../hooks/useHostRuns";
import {
  assignAgentToHost,
  deleteHost,
  getHostDetail,
  unassignAgentFromHost,
  updateHostApi,
} from "../../lib/apiAgents";
import {
  formatCost,
  formatPrimaryTime,
  getRunIdLabel,
  getRunKey,
} from "../runs/RunsSidebar";

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

  const host = hostname ? hosts.find((h) => h.name === hostname) : undefined;

  const {
    runs: hostRuns,
    total: hostRunsTotal,
    isLoading: hostRunsLoading,
    loadMore: loadMoreHostRuns,
    loadingMore: hostRunsLoadingMore,
    hasMore: hostRunsHasMore,
  } = useHostRuns(hostname);

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

  const handleAssign = async (agentId: number) => {
    if (!hostname) return;
    setAssigning(true);
    try {
      const result = await assignAgentToHost(hostname, agentId);
      if (result.success) {
        notifications.show({
          title: "Agent Assigned",
          message: result.message,
          color: "green",
        });
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  handleDiscard();
                }
              }}
              autoFocus
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
      <Table withRowBorders={false} style={{ maxWidth: 600 }}>
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
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm">
                    {formatVersion(host?.version || hostDetail?.version || "")}
                  </Text>
                  <VersionBadge
                    version={host?.version || hostDetail?.version}
                  />
                </Group>
              </Table.Td>
            </Table.Tr>
          )}
          {hostDetail?.environment && (
            <Table.Tr>
              <Table.Td c="dimmed">Environment</Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <PlatformBadge platform={hostDetail.environment.platform} />
                  <Text size="sm">
                    {hostDetail.environment.osVersion} ·{" "}
                    {hostDetail.environment.shell}
                    {hostDetail.environment.arch
                      ? ` · ${hostDetail.environment.arch}`
                      : ""}
                    {hostDetail.environment.nodeVersion
                      ? ` · node ${hostDetail.environment.nodeVersion}`
                      : ""}
                  </Text>
                </Group>
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
        </Table.Tbody>
      </Table>

      {/* Active Agents — not applicable for supervisor hosts */}
      {hostDetail?.hostType !== "supervisor" && (
        <>
          {activeAgents.length > 0 && (
            <>
              <Title order={4} pl="xs">
                Active Agents
              </Title>
              <Stack gap={4} pl="md">
                {activeAgents.map((agent) => (
                  <Group key={agent.id} gap="xs" wrap="nowrap">
                    <AgentModelIcon
                      shellModel={agent.shellModel}
                      size={14}
                      style={{ flexShrink: 0 }}
                    />
                    <Anchor
                      size="sm"
                      onClick={() => navigate(`/agents/${agent.name}`)}
                      style={{ cursor: "pointer" }}
                    >
                      {agent.name}
                    </Anchor>
                    <Text size="sm" c="dimmed">
                      ({agent.title})
                    </Text>
                  </Group>
                ))}
              </Stack>
            </>
          )}

          {/* Assigned Agents */}
          <Group gap="xs" pl="xs">
            <Title order={4}>Assigned Agents</Title>
            {hasAction(actions, "assign-agent") && (
              <Menu shadow="md" width={260} position="bottom-start">
                <Menu.Target>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="blue"
                    loading={assigning}
                    disabled={unassignedAgents.length === 0}
                    title="Assign agent"
                  >
                    <IconPlus size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  {unassignedAgents.map((a) => (
                    <Menu.Item
                      key={a.id}
                      onClick={() => void handleAssign(a.id)}
                    >
                      {a.name} — {a.title}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
          <Stack gap="md" pl="md">
            {hostDetail && hostDetail.assignedAgents.length > 0 && (
              <Stack gap={4}>
                {hostDetail.assignedAgents.map((agent) => {
                  const fullAgent = agents.find((a) => a.id === agent.id);
                  return (
                    <Group key={agent.id} gap="xs" wrap="nowrap">
                      <AgentModelIcon
                        shellModel={fullAgent?.shellModel}
                        size={14}
                        style={{ flexShrink: 0 }}
                      />
                      <Anchor
                        size="sm"
                        onClick={() => navigate(`/agents/${agent.name}`)}
                        style={{ cursor: "pointer" }}
                      >
                        {agent.name}
                      </Anchor>
                      <Text size="sm" c="dimmed">
                        ({agent.title})
                      </Text>
                      {hasActionTemplate(
                        hostDetail?._actionTemplates,
                        "unassignAgent",
                      ) && (
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() => void handleUnassign(agent.name)}
                          title="Unassign"
                        >
                          <IconX size={14} />
                        </ActionIcon>
                      )}
                    </Group>
                  );
                })}
              </Stack>
            )}

            {/* Restricted toggle */}
            {hasAction(actions, "update") ? (
              <Switch
                checked={editRestricted}
                onChange={(e) => setEditRestricted(e.currentTarget.checked)}
                label="Restricted — only assigned agents can run on this host"
                size="sm"
              />
            ) : (
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  Restricted:
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={host?.restricted ? "orange" : "gray"}
                >
                  {host?.restricted ? "Yes" : "No"}
                </Badge>
              </Group>
            )}
          </Stack>
        </>
      )}

      {/* Latest Runs */}
      <Title order={4} pl="xs">
        Latest Runs
      </Title>
      <Stack gap="md" pl="md">
        {hostRunsLoading && hostRuns.length === 0 ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
            <Text size="sm">Loading runs...</Text>
          </Group>
        ) : hostRuns.length === 0 ? (
          <Text c="dimmed" size="sm">
            No runs have been recorded on this host
          </Text>
        ) : (
          <>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>Run</Table.Th>
                  <Table.Th>Username</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>Cost</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>Lines</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {hostRuns.map((run) => {
                  const runKey = getRunKey(run);
                  const canNavigate = Boolean(run.username);
                  const runAgent = run.username
                    ? agents.find((a) => a.name === run.username)
                    : undefined;
                  return (
                    <Table.Tr
                      key={`${run.userId}-${runKey}`}
                      style={{ cursor: canNavigate ? "pointer" : "default" }}
                      onClick={() => {
                        if (canNavigate) {
                          void navigate(
                            `/agents/${run.username}/runs/${runKey}`,
                          );
                        }
                      }}
                    >
                      <Table.Td>{formatPrimaryTime(run.createdAt)}</Table.Td>
                      <Table.Td>{getRunIdLabel(run)}</Table.Td>
                      <Table.Td>
                        {run.username ? (
                          <Group gap={6} wrap="nowrap">
                            <AgentModelIcon
                              shellModel={runAgent?.shellModel}
                              size={14}
                              style={{ flexShrink: 0 }}
                            />
                            {run.username}
                          </Group>
                        ) : (
                          "—"
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="light" color="blue">
                          {run.modelName}
                        </Badge>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        <Text size="sm" c="green" fw={500}>
                          {formatCost(run.totalCost)}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: "right" }}>
                        {run.totalLines.toLocaleString()}
                      </Table.Td>
                      <Table.Td>
                        {run.isOnline && (
                          <Badge size="xs" variant="dot" color="green">
                            Online
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
            <Group justify="center" gap="sm">
              <Text c="dimmed" size="xs">
                Showing {hostRuns.length} / {hostRunsTotal} runs
              </Text>
              {hostRunsHasMore && (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  loading={hostRunsLoadingMore}
                  onClick={loadMoreHostRuns}
                >
                  Load More
                </Button>
              )}
            </Group>
          </>
        )}
      </Stack>
    </Stack>
  );
};
