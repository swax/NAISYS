import {
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Menu,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  ADMIN_USERNAME,
  formatDisabledReason,
  hasAction,
  type HateoasAction,
} from "@naisys/common";
import type { AgentDetailResponse } from "@naisys/supervisor-shared";
import { type ConfigRevision } from "@naisys/supervisor-shared";
import {
  IconArchive,
  IconArchiveOff,
  IconChevronDown,
  IconHistory,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconPower,
  IconTrash,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useHostDataContext } from "../../contexts/HostDataContext";
import { useConnectionStatus } from "../../hooks/useConnectionStatus";
import {
  archiveAgent,
  deleteAgentPermanently,
  disableAgent,
  enableAgent,
  getAgentDetail,
  getConfigRevisions,
  resetAgentSpend,
  startAgent,
  stopAgent,
  unarchiveAgent,
} from "../../lib/apiAgents";
import { ConfigSummary } from "./ConfigSummary";

export const AgentDetail: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { agents } = useAgentDataContext();
  const { hosts } = useHostDataContext();
  const { status: connectionStatus } = useConnectionStatus();

  const agentData = username ? agents.find((a) => a.name === username) : null;
  const [config, setConfig] = useState<AgentDetailResponse["config"] | null>(
    null,
  );
  const [assignedHosts, setAssignedHosts] = useState<
    { id: number; name: string }[] | undefined
  >();
  const [costSuspendedReason, setCostSuspendedReason] = useState<
    string | undefined
  >();
  const [actions, setActions] = useState<HateoasAction[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [taskInput, setTaskInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [currentSpend, setCurrentSpend] = useState<number | undefined>();
  const [spendLimitResetAt, setSpendLimitResetAt] = useState<
    string | undefined
  >();
  const [revisions, setRevisions] = useState<ConfigRevision[]>([]);
  const [selectedRevision, setSelectedRevision] =
    useState<ConfigRevision | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [resolvedEnvVars, setResolvedEnvVars] = useState<
    Record<string, string> | undefined
  >();

  const fetchDetail = async () => {
    if (!username) return;
    try {
      const data = await getAgentDetail(username);
      setConfig(data.config);
      setResolvedEnvVars(data.resolvedEnvVars);
      setAssignedHosts(data.assignedHosts);
      setCostSuspendedReason(data.costSuspendedReason);
      setCurrentSpend(data.currentSpend);
      setSpendLimitResetAt(data.spendLimitResetAt);
      setActions(data._actions);
    } catch (err) {
      console.error("Error fetching agent detail:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!username) {
      setLoading(false);
      return;
    }

    void fetchDetail();
  }, [username]);

  const fetchRevisions = async () => {
    if (!username) return;
    try {
      const data = await getConfigRevisions(username);
      setRevisions(data.items);
    } catch (err) {
      console.error("Error fetching config revisions:", err);
    }
  };

  const handleToggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && revisions.length === 0) {
      void fetchRevisions();
    }
    if (!next) {
      setSelectedRevision(null);
    }
  };

  const handleStart = async () => {
    if (!username) return;
    setStarting(true);
    try {
      const result = await startAgent(username, taskInput.trim() || undefined);
      if (result.success) {
        setTaskInput("");
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

  const handleStop = async (recursive?: boolean) => {
    if (!username) return;

    if (agentData?.name === ADMIN_USERNAME) {
      const confirmed = window.confirm(
        "The admin agent keeps the NAISYS process running when all other agents are stopped. " +
          "Stopping it may end the process. Are you sure?",
      );
      if (!confirmed) return;
    }

    setStopping(true);
    try {
      const result = await stopAgent(username, recursive);
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

  const handleToggleEnabled = async (recursive?: boolean) => {
    if (!username) return;
    const isEnabled = hasAction(actions, "disable");

    if (isEnabled) {
      const confirmed = window.confirm(
        recursive
          ? `Disable agent "${agentData?.name}" and all subordinates? Active agents will be stopped.`
          : `Disable agent "${agentData?.name}"? This will prevent it from being started.` +
              (agentData?.status === "active"
                ? " The agent is currently active and will be stopped."
                : ""),
      );
      if (!confirmed) return;
    }

    setToggling(true);
    try {
      const result = isEnabled
        ? await disableAgent(username, recursive)
        : await enableAgent(username, recursive);
      if (result.success) {
        notifications.show({
          title: isEnabled ? "Agent Disabled" : "Agent Enabled",
          message: result.message,
          color: isEnabled ? "orange" : "green",
        });
        await fetchDetail();
      } else {
        notifications.show({
          title: isEnabled ? "Disable Failed" : "Enable Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: isEnabled ? "Disable Failed" : "Enable Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setToggling(false);
    }
  };

  const handleArchive = async () => {
    if (!username) return;
    const confirmed = window.confirm(
      `Archive agent "${agentData?.name}"? It will be hidden from the main list but can still be edited.`,
    );
    if (!confirmed) return;

    setArchiving(true);
    try {
      const result = await archiveAgent(username);
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
    if (!username) return;
    setArchiving(true);
    try {
      const result = await unarchiveAgent(username);
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
    if (!username) return;
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
      const result = await deleteAgentPermanently(username);
      if (result.success) {
        notifications.show({
          title: "Agent Deleted",
          message: result.message,
          color: "red",
        });
        void navigate("/agents");
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

  const handleResetSpend = async () => {
    if (!username) return;
    const confirmed = window.confirm(
      `Reset the spend counter for "${agentData?.name}"? This will not delete any cost data.`,
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      const result = await resetAgentSpend(username);
      if (result.success) {
        notifications.show({
          title: "Spend Reset",
          message: result.message,
          color: "green",
        });
        await fetchDetail();
      } else {
        notifications.show({
          title: "Reset Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Reset Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setResetting(false);
    }
  };

  if (!username) {
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
    <Stack p="xs" maw={1000}>
      <Group wrap="nowrap" style={{ overflowX: "auto" }}>
        {(() => {
          const startAction = hasAction(actions, "start", {
            includeDisabled: true,
          });
          if (!startAction) return null;

          if (startAction.disabled) {
            const btn = (
              <Button
                color="green"
                disabled
                leftSection={<IconPlayerPlay size={16} />}
              >
                <Text visibleFrom="sm" span>
                  Start
                </Text>
              </Button>
            );
            const reason = formatDisabledReason(startAction.disabledReason);
            return reason ? (
              <Tooltip
                label={reason}
                multiline
                maw={350}
                style={{ whiteSpace: "pre-line" }}
              >
                {btn}
              </Tooltip>
            ) : (
              btn
            );
          }

          return (
            <Group gap={0} wrap="nowrap" style={{ flex: 1 }}>
              <TextInput
                placeholder="Task description (optional)"
                value={taskInput}
                onChange={(e) => setTaskInput(e.currentTarget.value)}
                disabled={agentData?.status === "offline"}
                style={{ flex: 1 }}
                styles={{
                  input: {
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                  },
                }}
              />
              <Button
                color="green"
                loading={starting}
                disabled={agentData?.status === "offline"}
                leftSection={<IconPlayerPlay size={16} />}
                onClick={handleStart}
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
              >
                <Text visibleFrom="sm" span>
                  Start
                </Text>
              </Button>
            </Group>
          );
        })()}
        <Button
          color="yellow"
          disabled
          leftSection={<IconPlayerPause size={16} />}
        >
          <Text visibleFrom="sm" span>
            Pause
          </Text>
        </Button>
        {(() => {
          const stopAction = hasAction(actions, "stop", {
            includeDisabled: true,
          });
          const stopDisabled = !stopAction || !!stopAction.disabled;
          return (
            <Group gap={0} wrap="nowrap">
              <Button
                color="red"
                disabled={stopDisabled}
                loading={stopping}
                leftSection={<IconPlayerStop size={16} />}
                onClick={() => handleStop()}
                style={{
                  borderTopRightRadius: 0,
                  borderBottomRightRadius: 0,
                }}
              >
                <Text visibleFrom="sm" span>
                  Stop
                </Text>
              </Button>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <Button
                    color="red"
                    disabled={stopDisabled || stopping}
                    style={{
                      borderTopLeftRadius: 0,
                      borderBottomLeftRadius: 0,
                      borderLeft: "1px solid rgba(255,255,255,0.3)",
                      paddingLeft: 6,
                      paddingRight: 6,
                    }}
                  >
                    <IconChevronDown size={16} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconPlayerStop size={14} />}
                    onClick={() => handleStop(true)}
                  >
                    Stop with Subordinates
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          );
        })()}
        {(hasAction(actions, "enable") || hasAction(actions, "disable")) && (
          <Group gap={0} wrap="nowrap">
            <Button
              color={hasAction(actions, "disable") ? "gray" : "teal"}
              loading={toggling}
              leftSection={<IconPower size={16} />}
              onClick={() => handleToggleEnabled()}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            >
              <Text visibleFrom="sm" span>
                {hasAction(actions, "disable") ? "Disable" : "Enable"}
              </Text>
            </Button>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button
                  color={hasAction(actions, "disable") ? "gray" : "teal"}
                  disabled={toggling}
                  style={{
                    borderTopLeftRadius: 0,
                    borderBottomLeftRadius: 0,
                    borderLeft: "1px solid rgba(255,255,255,0.3)",
                    paddingLeft: 6,
                    paddingRight: 6,
                  }}
                >
                  <IconChevronDown size={16} />
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconPower size={14} />}
                  onClick={() => handleToggleEnabled(true)}
                >
                  {hasAction(actions, "disable")
                    ? "Disable with Subordinates"
                    : "Enable with Subordinates"}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        )}
        {(() => {
          const archiveAction = hasAction(actions, "archive", {
            includeDisabled: true,
          });
          if (!archiveAction) return null;
          const btn = (
            <Button
              color="orange"
              loading={archiving}
              disabled={archiveAction.disabled}
              leftSection={<IconArchive size={16} />}
              onClick={archiveAction.disabled ? undefined : handleArchive}
            >
              <Text visibleFrom="sm" span>
                Archive
              </Text>
            </Button>
          );
          const reason = formatDisabledReason(archiveAction.disabledReason);
          return reason ? (
            <Tooltip
              label={reason}
              multiline
              maw={350}
              style={{ whiteSpace: "pre-line" }}
            >
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })()}
        {hasAction(actions, "unarchive") && (
          <Button
            color="teal"
            loading={archiving}
            leftSection={<IconArchiveOff size={16} />}
            onClick={handleUnarchive}
          >
            <Text visibleFrom="sm" span>
              Unarchive
            </Text>
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
            <Text visibleFrom="sm" span>
              Delete
            </Text>
          </Button>
        )}
      </Group>

      {agentData && connectionStatus === "connected" && (
        <Group gap="xs" align="center">
          <Badge
            size="sm"
            variant="light"
            color={
              agentData.status === "active"
                ? "green"
                : agentData.status === "suspended"
                  ? "red"
                  : agentData.status === "available"
                    ? "yellow"
                    : "gray"
            }
          >
            {agentData.status}
          </Badge>
          {agentData.status === "active" && agentData.host && (
            <Group gap={4} align="center">
              <Text size="sm" c="dimmed">
                Running on
              </Text>
              <Badge
                component={Link}
                to={`/hosts/${agentData.host}`}
                size="sm"
                variant="light"
                color="blue"
                style={{ cursor: "pointer" }}
              >
                {agentData.host}
              </Badge>
            </Group>
          )}
          {agentData.status === "suspended" && costSuspendedReason && (
            <Text size="sm" c="red">
              {costSuspendedReason}
            </Text>
          )}
        </Group>
      )}

      {config && (
        <ConfigSummary
          config={config}
          resolvedEnvVars={resolvedEnvVars}
          leadUsername={agentData?.leadUsername}
          assignedHosts={assignedHosts}
          hosts={hosts}
          agents={agents}
          currentSpend={currentSpend}
          spendLimitResetAt={spendLimitResetAt}
          canResetSpend={!!hasAction(actions, "reset-spend")}
          resettingSpend={resetting}
          onResetSpend={handleResetSpend}
        />
      )}

      <Button
        variant="subtle"
        size="compact-sm"
        leftSection={<IconHistory size={14} />}
        onClick={handleToggleHistory}
      >
        {showHistory ? "Hide Config History" : "Config History"}
      </Button>

      {showHistory && (
        <Stack gap="xs">
          {revisions.length === 0 ? (
            <Text size="sm" c="dimmed">
              No previous revisions
            </Text>
          ) : (
            <>
              <Group gap="xs" wrap="wrap">
                {revisions.map((rev) => (
                  <Button
                    key={rev.id}
                    size="compact-xs"
                    variant={
                      selectedRevision?.id === rev.id ? "filled" : "light"
                    }
                    onClick={() =>
                      setSelectedRevision(
                        selectedRevision?.id === rev.id ? null : rev,
                      )
                    }
                  >
                    {new Date(rev.createdAt).toLocaleString()}
                  </Button>
                ))}
              </Group>
              {selectedRevision && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed">
                    Changed by {selectedRevision.changedByUsername} on{" "}
                    {new Date(selectedRevision.createdAt).toLocaleString()}
                  </Text>
                  <Code block style={{ whiteSpace: "pre-wrap" }}>
                    {selectedRevision.config}
                  </Code>
                </Stack>
              )}
            </>
          )}
        </Stack>
      )}
    </Stack>
  );
};
