import {
  Badge,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import React from "react";

import { RunSession } from "../../types/runSession";
import { RunsCostChart } from "./RunsCostChart";

interface RunsSidebarProps {
  runs: RunSession[];
  totalRuns: number;
  runsLoading: boolean;
  agentName: string;
  selectedRowKey: string | null;
  onSelectRun: (run: RunSession) => void;
  hasUnreadLogs: (run: RunSession) => boolean;
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

export { formatCost, formatDuration,formatPrimaryTime };

export const RunsSidebar: React.FC<RunsSidebarProps> = ({
  runs,
  totalRuns,
  runsLoading,
  agentName,
  selectedRowKey,
  onSelectRun,
  hasUnreadLogs,
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
        {runs.map((run) => {
          const rowKey = getRowKey(run);
          const unread = hasUnreadLogs(run) && selectedRowKey !== rowKey;

          return (
            <NavLink
              key={rowKey}
              active={selectedRowKey === rowKey}
              onClick={() => onSelectRun(run)}
              label={
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" fw={500}>
                    {formatPrimaryTime(run.createdAt)}
                  </Text>
                  <Badge size="xs" variant="light" color="blue">
                    {run.modelName}
                  </Badge>
                </Group>
              }
              description={
                <Text size="xs" c="dimmed">
                  {getRunIdLabel(run)} &middot;{" "}
                  {formatDuration(run.createdAt, run.lastActive)}
                </Text>
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
                  borderBottom: "1px solid var(--mantine-color-dark-6)",
                },
              }}
            />
          );
        })}

        {runs.length === 0 && !runsLoading && (
          <Text c="dimmed" ta="center" size="sm" p="md">
            No runs available for {agentName}
          </Text>
        )}
      </ScrollArea>

      {totalRuns > 0 && (
        <Text
          c="dimmed"
          ta="center"
          size="xs"
          p="xs"
          style={{ borderTop: "1px solid var(--mantine-color-dark-6)" }}
        >
          Showing {Math.min(50, totalRuns)} / {totalRuns} runs
        </Text>
      )}
    </Stack>
  );
};
