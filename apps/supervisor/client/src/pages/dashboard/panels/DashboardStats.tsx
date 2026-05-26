import { Paper, SimpleGrid, Text } from "@mantine/core";
import { formatTokens } from "@naisys/common";
import type { DashboardStats as DashboardStatsData } from "@naisys/supervisor-shared";
import React from "react";

import { formatCost } from "../dashboardFormat";

const StatTile: React.FC<{ label: string; value: string; sub?: string }> = ({
  label,
  value,
  sub,
}) => (
  <Paper p="md" withBorder>
    <Text size="xs" c="dimmed" tt="uppercase">
      {label}
    </Text>
    <Text size="xl" fw={700}>
      {value}
    </Text>
    {/* Non-breaking space keeps tile heights aligned when there is no sub. */}
    <Text size="xs" c="dimmed">
      {sub ?? " "}
    </Text>
  </Paper>
);

export const DashboardStats: React.FC<{ stats: DashboardStatsData }> = ({
  stats,
}) => {
  const spendSub =
    stats.spendLimitDollars != null
      ? `limit ${formatCost(stats.spendLimitDollars)}` +
        (stats.spendLimitHours != null ? ` / ${stats.spendLimitHours}h` : "")
      : undefined;

  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
      <StatTile
        label="Agents active"
        value={`${stats.agentsActive} / ${stats.agentsTotal}`}
      />
      <StatTile label="Runs (24h)" value={String(stats.runsLast24h)} />
      <StatTile
        label="Spend (24h)"
        value={formatCost(stats.spendLast24h)}
        sub={spendSub}
      />
      <StatTile
        label="Tokens (24h)"
        value={formatTokens(stats.tokensLast24h)}
      />
    </SimpleGrid>
  );
};
