import {
  Container,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import React from "react";

import { getDashboard } from "../../lib/api/apiDashboard";
import { useBoomGuard } from "../../lib/useBoomGuard";
import { formatRelative } from "./dashboardFormat";
import { CostSummaryPanel } from "./panels/CostSummaryPanel";
import { DashboardStats } from "./panels/DashboardStats";
import { HostHealthPanel } from "./panels/HostHealthPanel";
import { LatestErrorsPanel } from "./panels/LatestErrorsPanel";
import { RecentMessagesPanel } from "./panels/RecentMessagesPanel";
import { RecentRunsPanel } from "./panels/RecentRunsPanel";
import { SuspendedAgentsAlert } from "./panels/SuspendedAgentsAlert";
import { UpcomingSchedulesPanel } from "./panels/UpcomingSchedulesPanel";

const REFRESH_INTERVAL_MS = 30_000;

export const DashboardPage: React.FC = () => {
  useBoomGuard("dashboard");

  const {
    data: response,
    isError,
    error,
  } = useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboard,
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const data = response?.data;

  return (
    <Container size="xl" py="md" w="100%">
      <Group justify="space-between" align="baseline" mb="md">
        <Title order={2}>Dashboard</Title>
        {data && (
          <Text size="xs" c="dimmed">
            Updated {formatRelative(data.generatedAt)}
          </Text>
        )}
      </Group>

      {isError ? (
        <Text c="red" ta="center" py="xl">
          Failed to load dashboard
          {error instanceof Error ? `: ${error.message}` : ""}
        </Text>
      ) : !data ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : (
        <Stack gap="md">
          <DashboardStats stats={data.stats} />
          <SuspendedAgentsAlert agents={data.suspendedAgents} />
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <RecentRunsPanel runs={data.recentRuns} />
            <RecentMessagesPanel messages={data.recentMessages} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <UpcomingSchedulesPanel schedules={data.upcomingSchedules} />
            <HostHealthPanel hosts={data.hosts} />
          </SimpleGrid>
          <CostSummaryPanel costSummary={data.costSummary} />
          <LatestErrorsPanel errorRuns={data.errorRuns} />
        </Stack>
      )}
    </Container>
  );
};
