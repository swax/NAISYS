import {
  Alert,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Badge,
  ActionIcon,
  Collapse,
} from "@mantine/core";
import { IconChevronRight, IconChevronDown } from "@tabler/icons-react";
import React, { useState, useEffect } from "react";
import {
  groupPromptEntries,
  GroupedLogComponent,
} from "../components/LogEntries";
import { useContextLog } from "../hooks/useContextLog";
import { LogEntry, RunSession } from "../lib/apiClient";

export const RunSessionCard: React.FC<{ run: RunSession }> = ({ run }) => {
  const [expanded, setExpanded] = useState(false);
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);

  // Fetch logs when expanded, but only continue polling if online
  const {
    data: logsResponse,
    isLoading: logsLoading,
    error: logsError,
  } = useContextLog(run.userId, run.runId, run.sessionId, expanded, run.isOnline);

  // Update logs from polling responses
  useEffect(() => {
    if (logsResponse?.success && logsResponse.data) {
      const newLogs = logsResponse.data.logs;

      setAllLogs((prevLogs) => {
        // If this is the first fetch, just use the new logs
        if (prevLogs.length === 0) {
          return newLogs;
        }

        // Create a map of existing logs for quick lookup
        const logsMap = new Map(prevLogs.map((log) => [log.id, log]));

        // Add new logs
        newLogs.forEach((log) => {
          logsMap.set(log.id, log);
        });

        // Convert back to array and sort by ID
        return Array.from(logsMap.values()).sort((a, b) => a.id - b.id);
      });
    }
  }, [logsResponse]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
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

  const getRunLabel = () => {
    if (run.sessionId > 1) {
      return `Run ${run.runId}-${run.sessionId}`;
    }
    return `Run ${run.runId}`;
  };

  const groupedLogs = groupPromptEntries(allLogs);

  return (
    <Card padding="md" radius="md" withBorder style={{ marginBottom: "8px" }}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap="xs" style={{ flex: 1 }}>
            <Group gap="xs">
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={() => setExpanded(!expanded)}
                size="sm"
              >
                {expanded ? (
                  <IconChevronDown size={16} />
                ) : (
                  <IconChevronRight size={16} />
                )}
              </ActionIcon>
              <Text size="sm" fw={600}>
                {getRunLabel()}
              </Text>
              <Badge size="sm" variant="light" color="blue">
                {run.modelName}
              </Badge>
              {run.isOnline && (
                <Badge size="sm" variant="dot" color="green">
                  Online
                </Badge>
              )}
            </Group>
            <Group gap="md">
              <Text size="xs" c="dimmed">
                Started: {formatDate(run.startDate)}
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

        <Collapse in={expanded}>
          {logsError && (
            <Alert color="red" title="Error loading logs">
              {logsError instanceof Error
                ? logsError.message
                : "Failed to load logs"}
            </Alert>
          )}

          {logsLoading && allLogs.length === 0 && (
            <Group justify="center">
              <Loader size="sm" />
              <Text size="sm">Loading logs...</Text>
            </Group>
          )}

          <Stack
            gap={0}
            style={{
              backgroundColor: "#1a1a1a",
              padding: "8px",
              borderRadius: "4px",
              maxHeight: "400px",
              overflowY: "auto",
            }}
          >
            {groupedLogs.map((item) => (
              <GroupedLogComponent
                key={
                  Array.isArray(item)
                    ? item.map((log) => log.id).join("-")
                    : item.id
                }
                item={item}
              />
            ))}
            {allLogs.length === 0 && !logsLoading && (
              <Text size="sm" c="dimmed" ta="center">
                No logs available for this run
              </Text>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </Card>
  );
};
