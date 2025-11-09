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
  Portal,
  Box,
} from "@mantine/core";
import { IconChevronRight, IconChevronDown, IconMaximize, IconMinimize, IconArrowBarToUp, IconArrowBarToDown } from "@tabler/icons-react";
import React, { useState, useEffect, useRef } from "react";
import {
  groupPromptEntries,
  GroupedLogComponent,
} from "../components/LogEntries";
import { useContextLog } from "../hooks/useContextLog";
import { LogEntry, RunSession } from "../lib/apiClient";

export const RunSessionCard: React.FC<{ run: RunSession }> = ({ run }) => {
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  // Handle ESC key to exit fullscreen
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && fullscreen) {
        setFullscreen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [fullscreen]);

  const formatPrimaryTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } else {
      const dateStr = date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
      const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

  const groupedLogs = groupPromptEntries(allLogs);

  const handleHeaderClick = (e: React.MouseEvent) => {
    // Don't toggle if clicking on the chevron icon or fullscreen button
    if ((e.target as HTMLElement).closest('[data-action-icon]')) {
      return;
    }
    setExpanded(!expanded);
  };

  const scrollToTop = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  const renderLogView = (isFullscreen: boolean = false) => (
    <Box style={{ position: "relative" }}>
      {isFullscreen && (
        <>
          <ActionIcon
            variant="filled"
            color="gray"
            onClick={() => setFullscreen(false)}
            size="lg"
            style={{
              position: "absolute",
              top: "8px",
              right: "24px",
              zIndex: 10,
            }}
            data-action-icon
          >
            <IconMinimize size={20} />
          </ActionIcon>
          <ActionIcon
            variant="filled"
            color="gray"
            onClick={scrollToTop}
            size="lg"
            style={{
              position: "absolute",
              top: "8px",
              right: "68px",
              zIndex: 10,
            }}
            data-action-icon
          >
            <IconArrowBarToUp size={20} />
          </ActionIcon>
          <ActionIcon
            variant="filled"
            color="gray"
            onClick={scrollToBottom}
            size="lg"
            style={{
              position: "absolute",
              top: "8px",
              right: "112px",
              zIndex: 10,
            }}
            data-action-icon
          >
            <IconArrowBarToDown size={20} />
          </ActionIcon>
        </>
      )}
      {!isFullscreen && expanded && (
        <ActionIcon
          variant="filled"
          color="gray"
          onClick={() => setFullscreen(true)}
          size="lg"
          style={{
            position: "absolute",
            top: "8px",
            right: "24px",
            zIndex: 10,
          }}
          data-action-icon
        >
          <IconMaximize size={20} />
        </ActionIcon>
      )}
      <Stack
        ref={scrollContainerRef}
        gap={0}
        style={{
          backgroundColor: "#1a1a1a",
          padding: "8px",
          borderRadius: "4px",
          maxHeight: isFullscreen ? "100vh" : "600px",
          height: isFullscreen ? "100vh" : "auto",
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
    </Box>
  );

  return (
    <>
      <Card padding="md" radius="md" withBorder style={{ marginBottom: "8px" }}>
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

          {renderLogView(false)}
        </Collapse>
      </Stack>
    </Card>

    {fullscreen && (
      <Portal>
        <Box
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#1a1a1a",
            zIndex: 1000,
          }}
        >
          {renderLogView(true)}
        </Box>
      </Portal>
    )}
    </>
  );
};
