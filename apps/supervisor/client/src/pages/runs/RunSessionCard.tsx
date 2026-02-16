import { ActionIcon, Badge, Card, Group, Stack, Text } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconFileText,
} from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { RunSession } from "../../types/runSession";
import { RunSessionLog } from "./RunSessionLog";

export const RunSessionCard: React.FC<{
  run: RunSession;
  freshData: boolean;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ run, freshData, isSelected, onSelect }) => {
  const [expanded, setExpanded] = useState(false);
  const runSessionCardRef = useRef<HTMLDivElement>(null);
  const { id: agentIdParam } = useParams<{ id: string }>();
  const { agents, readStatus } = useAgentDataContext();
  const agentName = agents.find((a) => a.id === Number(agentIdParam))?.name;
  const [searchParams] = useSearchParams();
  const [initialLoad, setInitialLoad] = useState(true);

  // Default expanded is determined on a delay as the useRunsData in Runs.tsx gets the latest data
  useEffect(() => {
    if (freshData && initialLoad) {
      setInitialLoad(false);

      const expandParam = searchParams.get("expand");

      // Expand if this card has unread logs
      if (expandParam === "new") {
        if (hasUnreadLogs()) {
          setExpanded(true);
        }
      }
      // Expand if this run is currently online
      else if (expandParam === "online") {
        setExpanded(run.isOnline);
      }
    }
  }, [freshData]);

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

  const getRunIdLabel = () => {
    if (run.sessionId > 1) {
      return `Run ID #${run.runId}-${run.sessionId}`;
    }
    return `Run ID #${run.runId}`;
  };

  const hasUnreadLogs = () => {
    if (!agentName) {
      return false;
    }
    const agentReadStatus = readStatus[agentName];
    if (!agentReadStatus) {
      return false;
    }

    return !expanded && run.latestLogId > agentReadStatus.lastReadLogId;
  };

  const handleHeaderClick = (e: React.MouseEvent) => {
    // Don't toggle if clicking on the chevron icon
    if ((e.target as HTMLElement).closest("[data-action-icon]")) {
      return;
    }
    // Don't toggle if user was selecting text (e.g. dragged from log area to header)
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
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
        onClick={handleHeaderClick}
        style={{
          marginBottom: "8px",
          scrollMarginBottom: "72px",
          cursor: "pointer",
          ...(isSelected && {
            borderColor: "#145592ff",
            borderWidth: "1px",
          }),
        }}
        ref={runSessionCardRef}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
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
                  {formatPrimaryTime(run.createdAt)}
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
                  Duration: {formatDuration(run.createdAt, run.lastActive)}
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
            <div
              style={{ cursor: "default" }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <RunSessionLog run={run} runSessionCardRef={runSessionCardRef} />
            </div>
          )}
        </Stack>
      </Card>
    </>
  );
};
