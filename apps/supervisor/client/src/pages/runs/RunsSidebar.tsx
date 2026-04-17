import {
  Badge,
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
  activeRunKey: string | undefined;
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
  `${run.userId}-${run.runId}-${run.sessionId}`;

export const getRunKey = (run: RunSession) => `${run.runId}-${run.sessionId}`;

export { formatCost, formatDuration, formatPrimaryTime };

export const RunsSidebar: React.FC<RunsSidebarProps> = ({
  runs,
  totalRuns,
  runsLoading,
  agentName,
  activeRunKey,
  onNavLinkClick,
  hasUnreadLogs,
  hasMore,
  loadingMore,
  onLoadMore,
}) => {
  return (
    <Stack gap={0} style={{ height: "100%" }}>
      <RunsCostChart runs={runs} />

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
            const runKey = getRunKey(run);
            const unread = hasUnreadLogs(run) && activeRunKey !== runKey;

            // Detect multi-session run grouping
            const prevRun = index > 0 ? runs[index - 1] : null;
            const nextRun = index < runs.length - 1 ? runs[index + 1] : null;
            const isMultiSession =
              run.sessionId > 1 ||
              (nextRun &&
                nextRun.runId === run.runId &&
                nextRun.userId === run.userId) ||
              (prevRun &&
                prevRun.runId === run.runId &&
                prevRun.userId === run.userId);
            const isFirstInGroup =
              isMultiSession &&
              (!prevRun ||
                prevRun.runId !== run.runId ||
                prevRun.userId !== run.userId);
            const isLastInGroup =
              isMultiSession &&
              (!nextRun ||
                nextRun.runId !== run.runId ||
                nextRun.userId !== run.userId);

            if (isFirstInGroup) groupIndex++;
            const groupColor = groupIndex % 2 === 0 ? "violet" : "blue";

            return (
              <NavLink
                key={rowKey}
                active={activeRunKey === runKey}
                component={Link}
                to={`/agents/${agentName}/runs/${runKey}`}
                onClick={onNavLinkClick}
                label={
                  <Stack gap={2}>
                    <Group
                      gap="xs"
                      wrap="nowrap"
                      justify="space-between"
                    >
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
                    <Group
                      gap="xs"
                      wrap="nowrap"
                      justify="space-between"
                    >
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
