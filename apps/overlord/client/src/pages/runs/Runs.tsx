import { Alert, Group, Loader, Stack, Text } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { RunSessionCard } from "./RunSessionCard";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useRunsData } from "../../hooks/useRunsData";

/** Re-rendering triggered by agentParam */
export const Runs: React.FC = () => {
  const { agent: agentName } = useParams<{ agent: string }>();
  const { agents } = useAgentDataContext();
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Find the agent and get their user ID
  const agent = agents.find((a) => a.name === agentName);
  const userId = agent?.id || 0;

  const {
    runs: allRuns,
    isLoading: runsLoading,
    error: runsError,
  } = useRunsData(userId, Boolean(agentName));

  // Clear state when agent changes
  useEffect(() => {
    setSelectedRowKey(null);
  }, [agentName]);

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

  return (
    <Stack gap="md" style={{ height: "100%" }}>
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
              defaultExpanded={Boolean(run.isFirst && run.isOnline)}
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
