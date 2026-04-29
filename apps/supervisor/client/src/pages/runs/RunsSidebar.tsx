import {
  Badge,
  Box,
  Button,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import type { RunSession } from "../../types/runSession";
import { RunsCostChart } from "./RunsCostChart";

interface RunsSidebarProps {
  runs: RunSession[];
  totalRuns: number;
  runsLoading: boolean;
  agentName: string;
  activeRunId: number | undefined;
  activeSessionId: number | undefined;
  activeSubagentId: number | null;
  onNavLinkClick?: () => void;
  hasUnreadLogs: (run: RunSession) => boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

const formatPrimaryTime = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } else {
    const dateStr = date.toLocaleDateString(undefined, {
      month: "numeric",
      day: "numeric",
    });
    const timeStr = date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${dateStr} ${timeStr}`;
  }
};

const formatCost = (cost: number) => `$${cost.toFixed(2)}`;

const formatDuration = (createdAt: string, lastActive: string) => {
  const start = new Date(createdAt);
  const end = new Date(lastActive);
  const durationMs = end.getTime() - start.getTime();

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
};

export const getRunIdLabel = (run: RunSession) => {
  if (run.sessionId > 1) {
    return `#${run.runId}-${run.sessionId}`;
  }
  return `#${run.runId}`;
};

export const getRowKey = (run: RunSession) =>
  `${run.userId}-${run.runId}-${run.subagentId ?? 0}-${run.sessionId}`;

export const runUrl = (
  agentName: string,
  run: { runId: number; sessionId: number; subagentId?: number | null },
) => {
  if (run.subagentId != null) {
    return `/agents/${agentName}/runs/${run.runId}/subagents/${run.subagentId}/sessions/${run.sessionId}`;
  }
  return `/agents/${agentName}/runs/${run.runId}/sessions/${run.sessionId}`;
};

const belongsToSameRunGroup = (
  a: RunSession | null | undefined,
  b: RunSession,
) => a != null && a.runId === b.runId && a.userId === b.userId;

export { formatCost, formatDuration, formatPrimaryTime };

export const RunsSidebar: React.FC<RunsSidebarProps> = ({
  runs,
  totalRuns,
  runsLoading,
  agentName,
  activeRunId,
  activeSessionId,
  activeSubagentId,
  onNavLinkClick,
  hasUnreadLogs,
  hasMore,
  loadingMore,
  onLoadMore,
}) => {
  return (
    <Stack gap={0} style={{ height: "100%" }}>
      <RunsCostChart runs={runs} agentName={agentName} />

      {runsLoading && runs.length === 0 && (
        <Group justify="center" p="md">
          <Loader size="sm" />
          <Text size="sm">Loading runs...</Text>
        </Group>
      )}

      <ScrollArea style={{ flex: 1 }}>
        {(() => {
          let groupIndex = 0;
          return runs.map((run, index) => {
            const rowKey = getRowKey(run);
            const isSubagent = run.subagentId != null;
            const isActive =
              activeRunId === run.runId &&
              activeSessionId === run.sessionId &&
              (run.subagentId ?? null) === activeSubagentId;
            const unread = hasUnreadLogs(run) && !isActive;

            // Detect multi-session run grouping
            const prevRun = index > 0 ? runs[index - 1] : null;
            const nextRun = index < runs.length - 1 ? runs[index + 1] : null;
            const prevInGroup = belongsToSameRunGroup(prevRun, run);
            const nextInGroup = belongsToSameRunGroup(nextRun, run);
            const isMultiSession =
              run.sessionId > 1 || isSubagent || prevInGroup || nextInGroup;
            const isFirstInGroup = isMultiSession && !prevInGroup;
            const isLastInGroup = isMultiSession && !nextInGroup;

            if (isFirstInGroup) groupIndex++;
            const groupColor = groupIndex % 2 === 0 ? "violet" : "blue";

            if (isSubagent) {
              // Compact, clickable row nested under the parent run. Same group
              // border so it visually belongs to the parent's session group.
              return (
                <Box
                  key={rowKey}
                  component={Link}
                  to={runUrl(agentName, run)}
                  onClick={onNavLinkClick}
                  pl="md"
                  pr="sm"
                  py={4}
                  style={{
                    borderBottom: isLastInGroup
                      ? "1px solid var(--mantine-color-dark-6)"
                      : "none",
                    borderLeft: `3px solid var(--mantine-color-${groupColor}-7)`,
                    borderBottomLeftRadius: isLastInGroup ? 4 : 0,
                    backgroundColor: isActive
                      ? "var(--mantine-color-dark-5)"
                      : undefined,
                    color: "inherit",
                    textDecoration: "none",
                    display: "block",
                  }}
                >
                  <Group gap="xs" justify="space-between" wrap="nowrap">
                    <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                      ↳ subagent ·{" "}
                      {formatDuration(run.createdAt, run.lastActive)}
                    </Text>
                    <Group gap={6} wrap="nowrap">
                      {run.isOnline && (
                        <Badge size="xs" variant="dot" color="green">
                          {run.paused ? "Paused" : "Online"}
                        </Badge>
                      )}
                      <Text size="xs" fw={500} c="green">
                        {formatCost(run.totalCost)}
                      </Text>
                    </Group>
                  </Group>
                </Box>
              );
            }

            return (
              <NavLink
                key={rowKey}
                active={isActive}
                component={Link}
                to={runUrl(agentName, run)}
                onClick={onNavLinkClick}
                label={
                  <Stack gap={2}>
                    <Group gap="xs" wrap="nowrap" justify="space-between">
                      <Text size="sm" fw={500}>
                        {formatPrimaryTime(run.createdAt)}
                      </Text>
                      {run.hostName && (
                        <Badge
                          size="xs"
                          variant="light"
                          color="cyan"
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {run.hostName}
                        </Badge>
                      )}
                    </Group>
                    <Group gap="xs" wrap="nowrap" justify="space-between">
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {getRunIdLabel(run)} &middot;{" "}
                        {formatDuration(run.createdAt, run.lastActive)}
                      </Text>
                      <Badge
                        size="xs"
                        variant="light"
                        color="blue"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {run.modelName}
                      </Badge>
                    </Group>
                  </Stack>
                }
                rightSection={
                  <Stack gap={2} align="flex-end">
                    <Text size="xs" fw={500} c="green">
                      {formatCost(run.totalCost)}
                    </Text>
                    <Group gap={4}>
                      {run.isOnline && (
                        <Badge size="xs" variant="dot" color="green">
                          Online
                        </Badge>
                      )}
                      {unread && (
                        <IconFileText
                          size={14}
                          color="var(--mantine-color-pink-5)"
                        />
                      )}
                    </Group>
                  </Stack>
                }
                styles={{
                  root: {
                    marginTop: isFirstInGroup ? 6 : 0,
                    borderBottom:
                      isMultiSession && !isLastInGroup
                        ? "none"
                        : "1px solid var(--mantine-color-dark-6)",
                    borderLeft: isMultiSession
                      ? `3px solid var(--mantine-color-${groupColor}-7)`
                      : undefined,
                    borderTopLeftRadius: isFirstInGroup ? 4 : 0,
                    borderBottomLeftRadius: isLastInGroup ? 4 : 0,
                  },
                }}
              />
            );
          });
        })()}

        {runs.length === 0 && !runsLoading && (
          <Text c="dimmed" ta="center" size="sm" p="md">
            No runs available for {agentName}
          </Text>
        )}
      </ScrollArea>

      {totalRuns > 0 && (
        <Stack
          gap={4}
          align="center"
          p="xs"
          style={{ borderTop: "1px solid var(--mantine-color-dark-6)" }}
        >
          <Text c="dimmed" ta="center" size="xs">
            Showing {runs.length} / {totalRuns} runs
          </Text>
          {hasMore && (
            <Button
              variant="subtle"
              size="compact-xs"
              loading={loadingMore}
              onClick={onLoadMore}
            >
              Load More
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
};
