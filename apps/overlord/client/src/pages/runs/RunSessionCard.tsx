import { ActionIcon, Badge, Card, Group, Stack, Text } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconFileText,
} from "@tabler/icons-react";
import React, { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { RunSession } from "../../types/runSession";
import { RunSessionLog } from "./RunSessionLog";

export const RunSessionCard: React.FC<{
  run: RunSession;
  defaultExpanded: boolean;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ run, defaultExpanded, isSelected, onSelect }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const runSessionCardRef = useRef<HTMLDivElement>(null);
  const { agent: agentParam } = useParams<{ agent: string }>();
  const { readStatus } = useAgentDataContext();

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

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(2)}`;
  };

  const formatDuration = (startDate: string, lastActive: string) => {
    const start = new Date(startDate);
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

  const getRunIdLabel = () => {
    if (run.sessionId > 1) {
      return `Run ID #${run.runId}-${run.sessionId}`;
    }
    return `Run ID #${run.runId}`;
  };

  const hasUnreadLogs = () => {
    if (!agentParam) return false;
    const agentReadStatus = readStatus[agentParam];
    if (!agentReadStatus) return false;
    return run.latestLogId > agentReadStatus.lastReadLogId;
  };

  const handleHeaderClick = (e: React.MouseEvent) => {
    // Don't toggle if clicking on the chevron icon
    if ((e.target as HTMLElement).closest("[data-action-icon]")) {
      return;
    }
    onSelect();
    setExpanded(!expanded);
  };

  return (
    <>
      <Card
        padding="md"
        radius="md"
        withBorder
        style={{
          marginBottom: "8px",
          scrollMarginBottom: "72px",
          ...(isSelected && {
            borderColor: "#145592ff",
            borderWidth: "1px",
          }),
        }}
        ref={runSessionCardRef}
      >
        <Stack gap="sm">
          <Group
            justify="space-between"
            align="flex-start"
            onClick={handleHeaderClick}
            style={{ cursor: "pointer" }}
          >
            <Stack gap="xs" style={{ flex: 1 }}>
              <Group gap="xs">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded(!expanded);
                  }}
                  size="sm"
                  data-action-icon
                >
                  {expanded ? (
                    <IconChevronDown size={16} />
                  ) : (
                    <IconChevronRight size={16} />
                  )}
                </ActionIcon>
                <Text size="sm" fw={600}>
                  {formatPrimaryTime(run.startDate)}
                </Text>
                <Badge size="sm" variant="light" color="blue">
                  {run.modelName}
                </Badge>
                {run.isOnline && (
                  <Badge size="sm" variant="dot" color="green">
                    Online
                  </Badge>
                )}
                {hasUnreadLogs() && (
                  <Badge
                    size="sm"
                    variant="light"
                    color="pink"
                    leftSection={<IconFileText size="0.8rem" />}
                  >
                    New logs
                  </Badge>
                )}
              </Group>
              <Group gap="md" ml={32}>
                <Text size="xs" c="dimmed">
                  {getRunIdLabel()}
                </Text>
                <Text size="xs" c="dimmed">
                  Duration: {formatDuration(run.startDate, run.lastActive)}
                </Text>
              </Group>
            </Stack>
            <Stack gap="xs" align="flex-end">
              <Text size="sm" fw={600} c="green">
                {formatCost(run.totalCost)}
              </Text>
              <Text size="xs" c="dimmed">
                {run.totalLines} lines
              </Text>
            </Stack>
          </Group>

          {expanded && (
            <RunSessionLog run={run} runSessionCardRef={runSessionCardRef} />
          )}
        </Stack>
      </Card>
    </>
  );
};
