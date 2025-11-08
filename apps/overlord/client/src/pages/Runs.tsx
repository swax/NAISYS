import {
  Alert,
  Badge,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { RunSessionCard } from "../components/RunSessionCard";
import { useNaisysDataContext } from "../contexts/NaisysDataContext";
import { useRunsData } from "../hooks/useRunsData";
import { RunSession } from "../lib/apiClient";

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
