import { Alert, Group, Loader, Stack, Text } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useRunsData } from "../../hooks/useRunsData";
import { RunsCostChart } from "./RunsCostChart";
import { RunSessionCard } from "./RunSessionCard";

/** Re-rendering triggered by agentParam */
export const Runs: React.FC = () => {
  const { agent: agentName } = useParams<{ agent: string }>();
  const { agents } = useAgentDataContext();
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [freshData, setFreshData] = useState<"loading" | "loaded">("loading");

  // Find the agent and get their user ID
  const agent = agents.find((a) => a.name === agentName);
  const userId = agent?.id || "";

  const {
    runs: allRuns,
    total: totalRuns,
    isLoading: runsLoading,
    error: runsError,
    isFetchedAfterMount,
  } = useRunsData(userId, Boolean(agentName));

  // There's a bug where even through isFetchedAfterMount is true, the latest log id of all runs is still old.
  // And usually on the next render cycle this is updated.
  // We need to have the latest data for auto-opening panels in RunSessionCard to work correctly.
  useEffect(() => {
    if (isFetchedAfterMount && freshData == "loading") {
      // Find max ULID using string comparison
      const runMaxLogId = allRuns.reduce(
        (max, run) => (run.latestLogId > max ? run.latestLogId : max),
        "",
      );

      // Once the run log id is at least the agent's latest log id, we know we have fresh data
      // ULIDs are lexicographically sortable
      if (agent?.latestLogId && runMaxLogId >= agent.latestLogId) {
        setFreshData("loaded");
      }
    }
  }, [freshData, isFetchedAfterMount, allRuns, agents]);

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

      <RunsCostChart runs={allRuns} />

      <Stack gap="xs">
        {allRuns.map((run) => {
          const rowKey = `${run.userId}-${run.runId}-${run.sessionId}`;
          return (
            <RunSessionCard
              key={rowKey}
              run={run}
              freshData={freshData == "loaded"}
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
        {totalRuns > 0 && (
          <Text c="dimmed" ta="center" size="sm" mt="md">
            Showing {Math.min(50, totalRuns)} / {totalRuns} runs
          </Text>
        )}
        <div ref={bottomRef} />
      </Stack>
    </Stack>
  );
};
