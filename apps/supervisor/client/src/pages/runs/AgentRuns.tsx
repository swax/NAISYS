import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Drawer,
  Group,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconList, IconSend } from "@tabler/icons-react";
import React, { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { SIDEBAR_WIDTH } from "../../constants";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useRunsData } from "../../hooks/useRunsData";
import { RunSession } from "../../types/runSession";
import { RunSessionLog } from "./RunSessionLog";
import {
  formatCost,
  formatDuration,
  formatPrimaryTime,
  getRowKey,
  getRunIdLabel,
  RunsSidebar,
} from "./RunsSidebar";

/** Re-rendering triggered by agentParam */
export const AgentRuns: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { agents, readStatus } = useAgentDataContext();
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [freshData, setFreshData] = useState<"loading" | "loaded">("loading");
  const [searchParams] = useSearchParams();
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();

  const agentId = id ? Number(id) : 0;
  const agent = agents.find((a) => a.id === agentId);
  const agentName = agent?.name;

  const {
    runs: allRuns,
    total: totalRuns,
    isLoading: runsLoading,
    error: runsError,
    isFetchedAfterMount,
  } = useRunsData(agentId, Boolean(id));

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

  // Auto-select a run when fresh data arrives based on URL params
  useEffect(() => {
    if (freshData !== "loaded") return;
    if (selectedRowKey) return; // Don't override user selection

    const expandParam = searchParams.get("expand");

    if (expandParam === "new") {
      // Select first run with unread logs
      const unreadRun = allRuns.find((run) => {
        if (!agentName) return false;
        const agentReadStatus = readStatus[agentName];
        if (!agentReadStatus) return false;
        return run.latestLogId > agentReadStatus.lastReadLogId;
      });
      if (unreadRun) {
        setSelectedRowKey(getRowKey(unreadRun));
        return;
      }
    } else if (expandParam === "online") {
      // Select first online run
      const onlineRun = allRuns.find((run) => run.isOnline);
      if (onlineRun) {
        setSelectedRowKey(getRowKey(onlineRun));
        return;
      }
    }

    // Fallback: select first run
    if (allRuns.length > 0) {
      setSelectedRowKey(getRowKey(allRuns[0]));
    }
  }, [freshData, allRuns, agentName, readStatus, searchParams, selectedRowKey]);

  // Clear state when agent changes
  useEffect(() => {
    setSelectedRowKey(null);
    setFreshData("loading");
  }, [id]);

  const selectedRun = allRuns.find((run) => getRowKey(run) === selectedRowKey);

  const hasUnreadLogs = useCallback(
    (run: RunSession) => {
      if (!agentName) return false;
      const agentReadStatus = readStatus[agentName];
      if (!agentReadStatus) return false;
      return run.latestLogId > agentReadStatus.lastReadLogId;
    },
    [agentName, readStatus],
  );

  const handleSelectRun = useCallback(
    (run: RunSession) => {
      setSelectedRowKey(getRowKey(run));
      closeDrawer();
    },
    [closeDrawer],
  );

  if (!id) {
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
        Agent with ID {id} not found
      </Alert>
    );
  }

  const sidebarContent = (
    <RunsSidebar
      runs={allRuns}
      totalRuns={totalRuns}
      runsLoading={runsLoading}
      agentName={agent.name}
      selectedRowKey={selectedRowKey}
      onSelectRun={handleSelectRun}
      hasUnreadLogs={hasUnreadLogs}
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
      <CollapsibleSidebar>
        {sidebarContent}
      </CollapsibleSidebar>

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
                <Text size="sm" fw={600}>
                  {formatPrimaryTime(selectedRun.createdAt)}
                </Text>
                <Badge size="sm" variant="light" color="blue">
                  {selectedRun.modelName}
                </Badge>
                {selectedRun.isOnline && (
                  <Badge size="sm" variant="dot" color="green">
                    Online
                  </Badge>
                )}
              </Group>
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  Run {getRunIdLabel(selectedRun)}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatDuration(selectedRun.createdAt, selectedRun.lastActive)}
                </Text>
                <Text size="sm" fw={500} c="green">
                  {formatCost(selectedRun.totalCost)}
                </Text>
              </Group>
            </Group>

            {/* Log content */}
            <RunSessionLog run={selectedRun} />

            {/* Placeholder input */}
            <Group
              gap="xs"
              p="xs"
              style={{ borderTop: "1px solid var(--mantine-color-dark-4)" }}
            >
              <Textarea
                placeholder="Send a message to the agent..."
                disabled
                autosize
                minRows={1}
                maxRows={1}
                style={{ flex: 1 }}
              />
              <ActionIcon variant="filled" color="blue" size="lg" disabled>
                <IconSend size={18} />
              </ActionIcon>
            </Group>
          </>
        )}
      </Box>
    </Box>
  );
};
