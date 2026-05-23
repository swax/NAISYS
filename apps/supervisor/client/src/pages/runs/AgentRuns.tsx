import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Drawer,
  Group,
  HoverCard,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { ADMIN_USERNAME } from "@naisys/common";
import {
  IconHelp,
  IconList,
  IconPlayerStop,
  IconSend,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";

import type { AppOutletContext } from "../../App";
import { getApiTypeBadgeColor } from "../../components/badges/ApiTypeBadge";
import {
  getPlatformBadge,
  getPlatformBadgeColor,
} from "../../components/badges/PlatformBadge";
import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { AgentPauseToggle } from "../../components/feature/AgentPauseToggle";
import { VoiceMicButton } from "../../components/feature/VoiceMicButton";
import { SIDEBAR_WIDTH } from "../../constants";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useRunsData } from "../../hooks/data/useRunsData";
import { useInputHistory } from "../../hooks/useInputHistory";
import { useLlmModels } from "../../hooks/useLlmModels";
import { stopAgent } from "../../lib/api/apiAgents";
import { sendRunCommand } from "../../lib/api/apiRuns";
import type { RunSession } from "../../types/runSession";
import { RunSessionLog } from "./RunSessionLog";
import {
  formatCost,
  formatDuration,
  formatPrimaryTime,
  getRunIdLabel,
  RunsSidebar,
  runUrl,
} from "./RunsSidebar";

/** Re-rendering triggered by agentParam */
export const AgentRuns: React.FC = () => {
  const {
    username,
    runId: runIdParam,
    sessionId: sessionIdParam,
    subagentId: subagentIdParam,
  } = useParams<{
    username: string;
    runId: string;
    sessionId: string;
    subagentId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { agents, readStatus } = useAgentDataContext();
  const { permissions, voice } = useOutletContext<AppOutletContext>();
  const llmModels = useLlmModels();
  const [freshData, setFreshData] = useState<"loading" | "loaded">("loading");
  const [searchParams] = useSearchParams();
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();

  const activeRunId = runIdParam !== undefined ? Number(runIdParam) : undefined;
  const activeSessionId =
    sessionIdParam !== undefined ? Number(sessionIdParam) : undefined;
  const activeSubagentId =
    subagentIdParam !== undefined ? Number(subagentIdParam) : null;

  const agent = agents.find((a) => a.name === username);
  const agentName = agent?.name;

  const {
    runs: allRuns,
    total: totalRuns,
    isLoading: runsLoading,
    error: runsError,
    isFetchedAfterMount,
    loadMore,
    loadingMore,
    hasMore,
    patchRun,
  } = useRunsData(username ?? "", Boolean(username));

  // There's a bug where even through isFetchedAfterMount is true, the latest log id of all runs is still old.
  // And usually on the next render cycle this is updated.
  // We need to have the latest data for auto-selecting runs to work correctly.
  useEffect(() => {
    if (isFetchedAfterMount && freshData == "loading") {
      const runMaxLogId = allRuns.reduce(
        (max, run) => (run.latestLogId > max ? run.latestLogId : max),
        0,
      );

      // Once the run log id is at least the agent's latest log id, we know we have fresh data
      if (agent?.latestLogId && runMaxLogId >= agent.latestLogId) {
        setFreshData("loaded");
      }
    }
  }, [freshData, isFetchedAfterMount, allRuns, agents]);

  // Auto-select a run when fresh data arrives and no run is in the URL
  useEffect(() => {
    if (freshData !== "loaded") return;
    if (activeRunId !== undefined) return; // URL already has a run selected
    if (allRuns.length === 0) return;

    const expandParam = searchParams.get("expand");
    // Auto-select only picks parent runs; subagents are reached via explicit click.
    const parentRuns = allRuns.filter((run) => run.subagentId == null);
    let targetRun: RunSession | undefined;

    if (expandParam === "new") {
      // Select first run with unread logs
      targetRun = parentRuns.find((run) => {
        if (!agentName) return false;
        const agentReadStatus = readStatus[agentName];
        if (!agentReadStatus) return false;
        return run.latestLogId > agentReadStatus.lastReadLogId;
      });
    } else if (expandParam === "online") {
      // Select first online run
      targetRun = parentRuns.find((run) => run.isOnline);
    }

    // Fallback: select first run
    if (!targetRun) {
      targetRun = parentRuns[0];
    }

    if (targetRun && username) {
      void navigate(runUrl(username, targetRun), { replace: true });
    }
  }, [
    freshData,
    allRuns,
    agentName,
    readStatus,
    searchParams,
    activeRunId,
    username,
    navigate,
  ]);

  // Clear state when agent changes
  useEffect(() => {
    setFreshData("loading");
  }, [username]);

  const selectedRun =
    activeRunId !== undefined && activeSessionId !== undefined
      ? allRuns.find(
          (run) =>
            run.runId === activeRunId &&
            run.sessionId === activeSessionId &&
            (run.subagentId ?? null) === activeSubagentId,
        )
      : undefined;

  // Browser back/forward can reuse this route component with the module-level
  // log cache already populated. Revalidate the active session log whenever
  // the route entry is activated so missed socket pushes are backfilled promptly.
  useEffect(() => {
    if (
      !username ||
      activeRunId === undefined ||
      activeSessionId === undefined
    ) {
      return;
    }
    const subagentKey = activeSubagentId ?? 0;
    const sessionKey = `${username}-${activeRunId}-${subagentKey}-${activeSessionId}`;
    void queryClient.invalidateQueries({
      queryKey: ["context-log", sessionKey],
      refetchType: "active",
    });
  }, [
    location.key,
    queryClient,
    username,
    activeRunId,
    activeSessionId,
    activeSubagentId,
  ]);

  const hasUnreadLogs = useCallback(
    (run: RunSession) => {
      if (!agentName) return false;
      const agentReadStatus = readStatus[agentName];
      if (!agentReadStatus) return false;
      return run.latestLogId > agentReadStatus.lastReadLogId;
    },
    [agentName, readStatus],
  );

  const [stopLoading, setStopLoading] = useState(false);

  const handleStop = async (run: RunSession) => {
    if (!username || stopLoading) return;
    if (!window.confirm("Stop this run?")) return;
    setStopLoading(true);
    try {
      const result = await stopAgent(username);
      if (result.success) {
        // Flip isOnline off locally so the Stop/pause/command surfaces
        // disappear immediately, rather than waiting for the next heartbeat
        // snapshot to drop the run.
        patchRun(run.userId, run.runId, run.sessionId, run.subagentId, {
          isOnline: false,
          paused: false,
        });
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
      setStopLoading(false);
    }
  };

  const [commandInput, setCommandInput] = useState("");
  const [commandSending, setCommandSending] = useState(false);
  const commandInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldRefocusCommandInputRef = useRef(false);

  const { pushHistory: pushCommandHistory, handleKeyDown: commandHistoryKeyDown } =
    useInputHistory({
      storageKey: username ? `run:${username}` : null,
      value: commandInput,
      onValueChange: setCommandInput,
      inputRef: commandInputRef,
    });

  useEffect(() => {
    if (commandSending || !shouldRefocusCommandInputRef.current) return;

    shouldRefocusCommandInputRef.current = false;
    const frame = requestAnimationFrame(() => {
      const input = commandInputRef.current;
      if (!input || input.disabled) return;

      input.focus();
      const cursor = input.value.length;
      input.setSelectionRange(cursor, cursor);
    });

    return () => cancelAnimationFrame(frame);
  }, [commandSending]);

  const handleSendCommand = async (run: RunSession, override?: string) => {
    if (!username || commandSending) return;
    // Blank input is meaningful — it bounces the agent into LLM mode,
    // bypassing an indefinite debug wait or remote pause for one cycle.
    // `override` lets the step-over button send "" without consuming whatever
    // the user has been typing.
    const command = override ?? commandInput.trim();
    shouldRefocusCommandInputRef.current = true;
    setCommandSending(true);
    try {
      const result = await sendRunCommand(
        username,
        run.runId,
        run.sessionId,
        command,
        run.subagentId,
      );
      if (result.success) {
        if (override === undefined) {
          setCommandInput("");
          pushCommandHistory(command);
        }
      } else {
        notifications.show({
          title: "Send Failed",
          message: result.message,
          color: "red",
        });
      }
    } catch (err) {
      notifications.show({
        title: "Send Failed",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
      });
    } finally {
      setCommandSending(false);
    }
  };

  if (!username) {
    return (
      <Stack gap="md" style={{ height: "100%" }}>
        <Group justify="space-between">
          <Text size="xl" fw={600}>
            Runs Overview
          </Text>
        </Group>

        <Stack gap="lg" align="center">
          <Text c="dimmed" ta="center">
            Select an agent from the sidebar to view their runs
          </Text>
        </Stack>
      </Stack>
    );
  }

  if (!agent) {
    return (
      <Alert color="yellow" title="Agent not found">
        Agent &quot;{username}&quot; not found
      </Alert>
    );
  }

  // Static system gate → per-user permission gate. shellModel isn't checked:
  // console mode dispatches commands through the host's shell wrapper, which
  // every running agent has even when its own LLM loop is idle.
  const voiceDisabledReason = !voice.available
    ? (voice.reason ?? "Voice is unavailable.")
    : !permissions.includes("agent_communication")
      ? "You need the agent_communication permission to start a voice session."
      : undefined;

  const sidebarContent = (
    <RunsSidebar
      runs={allRuns}
      totalRuns={totalRuns}
      runsLoading={runsLoading}
      agentName={agent.name}
      agentTokenMax={agent.tokenMax}
      activeRunId={activeRunId}
      activeSessionId={activeSessionId}
      activeSubagentId={activeSubagentId}
      onNavLinkClick={closeDrawer}
      hasUnreadLogs={hasUnreadLogs}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
    />
  );

  return (
    <Box
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {runsError && (
        <Alert
          color="red"
          title="Error loading runs"
          style={{ position: "absolute", zIndex: 10 }}
        >
          {runsError instanceof Error
            ? runsError.message
            : "Failed to load runs"}
        </Alert>
      )}

      {/* Desktop sidebar */}
      <CollapsibleSidebar>{sidebarContent}</CollapsibleSidebar>

      {/* Mobile drawer */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title="Runs"
        size={SIDEBAR_WIDTH}
      >
        {sidebarContent}
      </Drawer>

      {/* Main panel */}
      <Box
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {!selectedRun ? (
          <Box
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActionIcon
              hiddenFrom="sm"
              variant="subtle"
              color="gray"
              onClick={openDrawer}
              mb="xs"
            >
              <IconList size="1.2rem" />
            </ActionIcon>
            <Text c="dimmed">Select a run to view its logs</Text>
          </Box>
        ) : (
          <>
            {/* Run header */}
            <Group
              gap="xs"
              p="xs"
              px="md"
              justify="space-between"
              style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
            >
              <Group gap="xs">
                {/* Mobile toggle */}
                <ActionIcon
                  hiddenFrom="sm"
                  variant="subtle"
                  color="gray"
                  onClick={openDrawer}
                >
                  <IconList size="1.2rem" />
                </ActionIcon>
                <Text
                  size="sm"
                  fw={600}
                  hiddenFrom="sm"
                  onClick={openDrawer}
                  style={{ cursor: "pointer" }}
                >
                  {formatPrimaryTime(selectedRun.createdAt)}
                </Text>
                <Text size="sm" fw={600} visibleFrom="sm">
                  {formatPrimaryTime(selectedRun.createdAt)}
                </Text>
                {selectedRun.subagentId != null && (
                  <Badge size="sm" variant="light" color="violet">
                    ↳ Subagent {selectedRun.subagentId}
                  </Badge>
                )}
                {selectedRun.hostName && (
                  <Badge
                    size="sm"
                    variant="light"
                    color={getPlatformBadgeColor(
                      selectedRun.hostEnvironment?.platform,
                    )}
                    component={Link}
                    to={`/hosts/${selectedRun.hostName}`}
                    style={{ cursor: "pointer" }}
                  >
                    {selectedRun.hostName}
                  </Badge>
                )}
                {selectedRun.hostEnvironment &&
                  (() => {
                    const meta = getPlatformBadge(
                      selectedRun.hostEnvironment.platform,
                    );
                    return (
                      <Tooltip label={selectedRun.hostEnvironment.osVersion}>
                        <Badge size="sm" variant="light" color={meta.color}>
                          {meta.label}
                        </Badge>
                      </Tooltip>
                    );
                  })()}
                <Badge
                  size="sm"
                  variant="light"
                  color={getApiTypeBadgeColor(
                    llmModels.find((m) => m.key === selectedRun.modelName)
                      ?.apiType,
                  )}
                  component={Link}
                  to={`/models/${encodeURIComponent(selectedRun.modelName)}`}
                  style={{ cursor: "pointer" }}
                >
                  {selectedRun.modelName}
                </Badge>
                {selectedRun.isOnline && (
                  <Badge size="sm" variant="dot" color="green">
                    Online
                  </Badge>
                )}
                {selectedRun.isOnline &&
                  selectedRun.subagentId == null &&
                  username !== ADMIN_USERNAME && (
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="red"
                    loading={stopLoading}
                    leftSection={<IconPlayerStop size={12} />}
                    onClick={() => void handleStop(selectedRun)}
                  >
                    Stop
                  </Button>
                )}
              </Group>
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  Run {getRunIdLabel(selectedRun)}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatDuration(
                    selectedRun.createdAt,
                    selectedRun.lastActive,
                  )}
                </Text>
                <Text size="sm" fw={500} c="green">
                  {formatCost(selectedRun.totalCost)}
                </Text>
              </Group>
            </Group>

            {/* Log content — footer travels with the log into fullscreen mode. */}
            <RunSessionLog
              run={selectedRun}
              footer={
                <Group
                  gap="xs"
                  p="xs"
                  style={{
                    borderTop: "1px solid var(--mantine-color-dark-4)",
                  }}
                >
                  <HoverCard
                    width={340}
                    shadow="md"
                    withArrow
                    position="top-start"
                  >
                    <HoverCard.Target>
                      <ActionIcon variant="subtle" color="gray" size="lg">
                        <IconHelp size={18} />
                      </ActionIcon>
                    </HoverCard.Target>
                    <HoverCard.Dropdown>
                      <Stack gap={6}>
                        <Text size="sm" fw={600}>
                          Remote command input
                        </Text>
                        <Text size="xs">
                          <Code>Enter</Code> to send, <Code>Shift+Enter</Code>{" "}
                          for a new line.
                        </Text>
                        <Text size="xs">
                          Send <Code>ns-help</Code> to see available commands.
                        </Text>
                        <Text size="xs">
                          Prefix with <Code>@</Code> to send a message and
                          trigger the next LLM iteration.
                        </Text>
                        <Text size="xs">
                          Prefix with <Code>!</Code> to run a shell command the
                          LLM can see — added to its context (coming soon).
                        </Text>
                        <Text size="xs">
                          Otherwise, commands run on the shell without being
                          added to the LLM&apos;s context.
                        </Text>
                        <Text size="xs">
                          Send blank to bounce the agent into LLM mode for one
                          cycle — bypasses a paused or indefinite debug wait.
                        </Text>
                        <Text size="sm" fw={600} mt={4}>
                          Log colors
                        </Text>
                        <Text size="xs">
                          <Text span c="green">
                            Green
                          </Text>{" "}
                          — info &amp; debug (off-context)
                        </Text>
                        <Text size="xs">
                          <Text span>White</Text> — shell output (in context)
                        </Text>
                        <Text size="xs">
                          <Text span c="magenta">
                            Magenta
                          </Text>{" "}
                          — LLM output (in context)
                        </Text>
                        <Text size="xs">
                          <Text span c="red">
                            Red
                          </Text>{" "}
                          — errors (off-context)
                        </Text>
                      </Stack>
                    </HoverCard.Dropdown>
                  </HoverCard>
                  {selectedRun.isOnline && username && (
                    <AgentPauseToggle
                      username={username}
                      runId={selectedRun.runId}
                      sessionId={selectedRun.sessionId}
                      subagentId={selectedRun.subagentId}
                      paused={selectedRun.paused ?? false}
                      onPauseChanged={(paused) =>
                        patchRun(
                          selectedRun.userId,
                          selectedRun.runId,
                          selectedRun.sessionId,
                          selectedRun.subagentId,
                          { paused },
                        )
                      }
                    />
                  )}
                  <Textarea
                    ref={commandInputRef}
                    placeholder={
                      selectedRun.isOnline
                        ? "Send a command to the agent..."
                        : "Run is offline"
                    }
                    disabled={!selectedRun.isOnline || commandSending}
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      commandHistoryKeyDown(e);
                      if (e.defaultPrevented) return;
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendCommand(selectedRun);
                      }
                    }}
                    autosize
                    minRows={1}
                    maxRows={4}
                    style={{ flex: 1 }}
                  />
                  <ActionIcon
                    variant="filled"
                    color="blue"
                    size="lg"
                    disabled={!selectedRun.isOnline || commandSending}
                    loading={commandSending}
                    onClick={() => void handleSendCommand(selectedRun)}
                  >
                    <IconSend size={18} />
                  </ActionIcon>
                  {username && (
                    <VoiceMicButton
                      fromUsername="admin"
                      fromTitle="Admin"
                      targetUsername={username}
                      targetTitle={agent.title ?? username}
                      mode="console"
                      disabledReason={voiceDisabledReason}
                    />
                  )}
                  {selectedRun.isOnline && selectedRun.paused && (
                    <Tooltip label="Step over — same as pressing Enter on a blank line, sends a blank command">
                      <ActionIcon
                        variant="light"
                        color="grape"
                        size="lg"
                        disabled={commandSending}
                        onClick={() => void handleSendCommand(selectedRun, "")}
                      >
                        <svg
                          width={18}
                          height={18}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 14 A7 7 0 0 1 19 14" />
                          <path d="M16 11 L19 14 L22 11" />
                          <circle
                            cx="12"
                            cy="17"
                            r="1.5"
                            fill="currentColor"
                            stroke="none"
                          />
                        </svg>
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              }
            />
          </>
        )}
      </Box>
    </Box>
  );
};
