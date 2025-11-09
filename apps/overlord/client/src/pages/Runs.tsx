import { Alert, Badge, Group, Loader, Stack, Text } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { RunSessionCard } from "../components/RunSessionCard";
import { useNaisysDataContext } from "../contexts/NaisysDataContext";
import { useRunsData } from "../hooks/useRunsData";
import { RunSession } from "../lib/apiClient";

type RunSessionWithFlag = RunSession & { isLast?: boolean };

/** Re-rendering triggered by agentParam */
export const Runs: React.FC = () => {
  const { agent: agentName } = useParams<{ agent: string }>();
  const { agents } = useNaisysDataContext();
  const [allRuns, setAllRuns] = useState<RunSessionWithFlag[]>([]);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Find the agent and get their user ID
  const agent = agents.find((a) => a.name === agentName);
  const userId = agent?.id || 0;

  const {
    data: runsResponse,
    isLoading: runsLoading,
    error: runsError,
  } = useRunsData(userId, Boolean(agentName));

  // Clear runs when agent changes
  useEffect(() => {
    setAllRuns([]);
    setHasScrolledToBottom(false);
    setSelectedRowKey(null);
  }, [agentName]);

  // Update runs from polling responses
  useEffect(() => {
    if (runsResponse?.success && runsResponse.data) {
      const updatedRuns = runsResponse.data.runs;

      setAllRuns((prevRuns) => {
        let newRuns: RunSession[] = [];

        // If this is the first fetch, just use the new runs
        if (prevRuns.length === 0) {
          newRuns = updatedRuns;
        } else {
          // Create a map of existing runs for quick lookup
          const mergeRuns = new Map(
            prevRuns.map((run) => [
              `${run.userId}-${run.runId}-${run.sessionId}`,
              run,
            ]),
          );

          // Update existing runs and add new ones
          updatedRuns.forEach((run) => {
            mergeRuns.set(`${run.userId}-${run.runId}-${run.sessionId}`, run);
          });

          newRuns = Array.from(mergeRuns.values());
        }

        // Convert back to array and sort by last active (oldest first, latest at bottom)
        const sortedRuns: RunSessionWithFlag[] = newRuns.sort(
          (a, b) =>
            new Date(a.lastActive).getTime() - new Date(b.lastActive).getTime(),
        );

        // Mark last run
        if (sortedRuns.length > 0) {
          sortedRuns[sortedRuns.length - 1].isLast = true;
        }

        return sortedRuns;
      });
    }
  }, [runsResponse]);

  // Scroll to bottom on first load
  useEffect(() => {
    if (allRuns.length > 0 && !hasScrolledToBottom && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "instant", block: "end" });
      setHasScrolledToBottom(true);
    }
  }, [allRuns, hasScrolledToBottom]);

  if (!agentName) {
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
        Agent "{agentName}" not found
      </Alert>
    );
  }

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(2)}`;
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
        {allRuns.map((run) => {
          const rowKey = `${run.userId}-${run.runId}-${run.sessionId}`;
          return (
            <RunSessionCard
              key={rowKey}
              run={run}
              defaultExpanded={Boolean(run.isLast)}
              isSelected={selectedRowKey === rowKey}
              onSelect={() => setSelectedRowKey(rowKey)}
            />
          );
        })}
        {allRuns.length === 0 && !runsLoading && (
          <Text c="dimmed" ta="center">
            No runs available for {agent.name}
          </Text>
        )}
        <div ref={bottomRef} />
      </Stack>
    </Stack>
  );
};
