import { Anchor, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { formatTokens } from "@naisys/common";
import type { DashboardCostSummary } from "@naisys/supervisor-shared";
import { IconChartLine } from "@tabler/icons-react";
import type { ChartData, ChartOptions } from "chart.js";
import React, { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { Link } from "react-router-dom";

import { useColorResolver } from "../../../lib/charts";
import { formatCost } from "../dashboardFormat";

export const CostSummaryPanel: React.FC<{
  costSummary: DashboardCostSummary;
}> = ({ costSummary }) => {
  const resolveColor = useColorResolver();
  const { buckets, byAgent } = costSummary;

  const costColor = resolveColor("blue.6");
  const tokenColor = resolveColor("orange.6");

  const chartData = useMemo<ChartData<"line">>(
    () => ({
      labels: buckets.map((b) =>
        new Date(b.start).toLocaleTimeString("en-US", { hour: "numeric" }),
      ),
      datasets: [
        {
          label: "Cost",
          data: buckets.map((b) => Math.round(b.cost * 100) / 100),
          borderColor: costColor,
          backgroundColor: costColor,
          yAxisID: "y",
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: "Tokens",
          data: buckets.map((b) => b.tokens),
          borderColor: tokenColor,
          backgroundColor: tokenColor,
          yAxisID: "y1",
          tension: 0.3,
          pointRadius: 2,
        },
      ],
    }),
    [buckets, costColor, tokenColor],
  );

  const chartOptions = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ctx.dataset.label === "Cost"
                ? `Cost: $${Number(ctx.parsed.y).toFixed(2)}`
                : `Tokens: ${formatTokens(Number(ctx.parsed.y))}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
        y: {
          position: "left",
          title: { display: true, text: "Cost" },
          ticks: { callback: (v) => `$${Number(v).toFixed(2)}` },
        },
        y1: {
          position: "right",
          title: { display: true, text: "Tokens" },
          grid: { drawOnChartArea: false },
          ticks: { callback: (v) => formatTokens(Number(v)) },
        },
      },
    }),
    [],
  );

  return (
    <Paper p="md" withBorder>
      <Group gap={8} mb="sm">
        <IconChartLine size={18} />
        <Text fw={600}>Cost &amp; token usage — last 24 hours</Text>
      </Group>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <div style={{ height: 240 }}>
          <Line data={chartData} options={chartOptions} />
        </div>
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" mb="xs">
            Top agents by spend
          </Text>
          {byAgent.length === 0 ? (
            <Text size="sm" c="dimmed">
              No agent activity in the last 24 hours.
            </Text>
          ) : (
            <Stack gap={6}>
              {byAgent.map((a) => (
                <Group key={a.username} justify="space-between" wrap="nowrap">
                  <Anchor
                    component={Link}
                    to={`/agents/${a.username}`}
                    size="sm"
                    truncate
                  >
                    {a.username}
                  </Anchor>
                  <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                    {formatCost(a.cost)} · {formatTokens(a.tokens)}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </div>
      </SimpleGrid>
    </Paper>
  );
};
