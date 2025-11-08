import { Alert, Card, Group, Loader, Stack, Text } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  groupPromptEntries,
  GroupedLogComponent,
} from "../components/LogEntries";
import { useNaisysDataContext } from "../contexts/NaisysDataContext";

export const Log: React.FC = () => {
  const { agent: agentParam } = useParams<{ agent: string }>();
  const {
    agents,
    getLogsForAgent,
    isLoading: logsLoading,
    error: logsError,
    readStatus,
    updateReadStatus,
  } = useNaisysDataContext();
  const [autoScroll, setAutoScroll] = useState(true);

  // Get filtered logs for the current agent
  const logs = getLogsForAgent(agentParam);
  const groupedLogs = groupPromptEntries(logs);

  // Update read status when viewing logs - only when latest log ID changes
  useEffect(() => {
    if (!agentParam || !readStatus[agentParam]) return;

    // Get read status for the current agent
    const userReadStatus = readStatus[agentParam];

    const latestLogId = userReadStatus.latestLogId;
    if (latestLogId > userReadStatus.lastReadLogId) {
      updateReadStatus(agentParam, latestLogId);
    }
  }, [logs, readStatus, updateReadStatus]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll) {
      const htmlElement = document.documentElement;
      htmlElement.scrollTo({
        top: htmlElement.scrollHeight,
      });
    }
  }, [groupedLogs, autoScroll]);

  // Handle scroll detection to pause auto-scroll when user scrolls up
  const handleScroll = () => {
    const htmlElement = document.documentElement;
    const { scrollTop, scrollHeight, clientHeight } = htmlElement;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
    setAutoScroll(isAtBottom);
  };

  // Add scroll event listener to html element
  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (logsLoading) {
    return <Loader size="lg" />;
  }

  if (!agentParam) {
    return (
      <Stack gap="md" style={{ height: "100%" }}>
        <Group justify="space-between">
          <Text size="xl" fw={600}>
            Log Overview
          </Text>
        </Group>

        {logsError && (
          <Alert color="red" title="Error loading logs">
            {logsError instanceof Error
              ? logsError.message
              : "Failed to load logs"}
          </Alert>
        )}

        {logsLoading ? (
          <Group justify="center">
            <Loader size="md" />
            <Text>Loading logs...</Text>
          </Group>
        ) : (
          <Stack gap="lg" align="center">
            <Card padding="xl" radius="md" withBorder>
              <Stack gap="sm" align="center">
                <Text size="xl" fw={700} c="blue">
                  {logs.length}
                </Text>
                <Text size="lg" c="dimmed">
                  Total Log Lines
                </Text>
              </Stack>
            </Card>
            <Text c="dimmed" ta="center">
              Select an agent from the sidebar to view their logs
            </Text>
          </Stack>
        )}
      </Stack>
    );
  }

  const agent = agents.find((a) => a.name === agentParam);

  if (!agent) {
    return (
      <Alert color="yellow" title="Agent not found">
        Agent "{agentParam}" not found
      </Alert>
    );
  }

  return (
    <Stack gap="md" style={{ height: "100%" }}>
      {logsError && (
        <Alert color="red" title="Error loading logs">
          {logsError instanceof Error
            ? logsError.message
            : "Failed to load logs"}
        </Alert>
      )}

      {logsLoading && logs.length === 0 && (
        <Group justify="center">
          <Loader size="md" />
          <Text>Loading logs...</Text>
        </Group>
      )}

      <Stack gap={0}>
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
        {logs.length === 0 && !logsLoading && (
          <Text c="dimmed" ta="center">
            No logs available for {agent.name}
          </Text>
        )}
      </Stack>

      {!autoScroll && (
        <Text size="sm" c="blue" ta="center">
          Auto-scroll paused. Scroll to bottom to resume.
        </Text>
      )}
    </Stack>
  );
};
