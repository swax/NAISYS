import {
  Alert,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Badge,
} from "@mantine/core";
import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useNaisysDataContext } from "../contexts/NaisysDataContext";
import { useRunsData } from "../hooks/useRunsData";
import { RunSession } from "../lib/apiClient";

const RunSessionCard: React.FC<{ run: RunSession }> = ({ run }) => {
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

  return (
    <Card padding="md" radius="md" withBorder style={{ marginBottom: "8px" }}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap="xs" style={{ flex: 1 }}>
            <Group gap="xs">
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
      </Stack>
    </Card>
  );
};

export const Runs: React.FC = () => {
  const { agent: agentParam } = useParams<{ agent: string }>();
  const { agents } = useNaisysDataContext();
  const [allRuns, setAllRuns] = useState<RunSession[]>([]);

  // Find the agent and get their user ID
  const agent = agents.find((a) => a.name === agentParam);
  const userId = agent?.id || 0;

  const {
    data: runsResponse,
    isLoading: runsLoading,
    error: runsError,
  } = useRunsData(userId, !!agent);

  // Update runs from polling responses
  useEffect(() => {
    if (runsResponse?.success && runsResponse.data) {
      const newRuns = runsResponse.data.runs;

      setAllRuns((prevRuns) => {
        // If this is the first fetch, just use the new runs
        if (prevRuns.length === 0) {
          return newRuns;
        }

        // Create a map of existing runs for quick lookup
        const runsMap = new Map(
          prevRuns.map((run) => [
            `${run.userId}-${run.runId}-${run.sessionId}`,
            run,
          ]),
        );

        // Update existing runs and add new ones
        newRuns.forEach((run) => {
          runsMap.set(`${run.userId}-${run.runId}-${run.sessionId}`, run);
        });

        // Convert back to array and sort by last active (oldest first, latest at bottom)
        return Array.from(runsMap.values()).sort(
          (a, b) =>
            new Date(a.lastActive).getTime() - new Date(b.lastActive).getTime(),
        );
      });
    }
  }, [runsResponse]);

  if (!agentParam) {
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
        Agent "{agentParam}" not found
      </Alert>
    );
  }

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  const totalLines = allRuns.reduce((sum, run) => sum + run.totalLines, 0);
  const totalCost = allRuns.reduce((sum, run) => sum + run.totalCost, 0);

  return (
    <Stack gap="md" style={{ height: "100%" }}>
      <Group justify="space-between">
        <Text size="xl" fw={600}>
          Runs for {agent.name}
        </Text>
        <Group gap="md">
          <Badge size="lg" variant="light" color="violet">
            {totalLines.toLocaleString()} total lines
          </Badge>
          <Badge size="lg" variant="light" color="green">
            {formatCost(totalCost)} total cost
          </Badge>
          <Badge size="lg" variant="light" color="blue">
            {allRuns.length} runs
          </Badge>
        </Group>
      </Group>

      {runsError && (
        <Alert color="red" title="Error loading runs">
          {runsError instanceof Error
            ? runsError.message
            : "Failed to load runs"}
        </Alert>
      )}

      {runsLoading && allRuns.length === 0 && (
        <Group justify="center">
          <Loader size="md" />
          <Text>Loading runs...</Text>
        </Group>
      )}

      <Stack gap="xs">
        {allRuns.map((run) => (
          <RunSessionCard
            key={`${run.userId}-${run.runId}-${run.sessionId}`}
            run={run}
          />
        ))}
        {allRuns.length === 0 && !runsLoading && (
          <Text c="dimmed" ta="center">
            No runs available for {agent.name}
          </Text>
        )}
      </Stack>
    </Stack>
  );
};
