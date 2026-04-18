import { Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import type { ChartData, ChartOptions } from "chart.js";
import React, { useMemo } from "react";
import { Scatter } from "react-chartjs-2";

import { useColorResolver } from "../../lib/charts";
import { useModelsContext } from "./ModelsLayout";

interface ScatterPanelProps {
  title: string;
  points: { x: number; y: number; label: string }[];
  color: string;
  xAxisLabel: string;
  yAxisLabel: string;
  height: number;
}

const ScatterPanel: React.FC<ScatterPanelProps> = ({
  title,
  points,
  color,
  xAxisLabel,
  yAxisLabel,
  height,
}) => {
  const data = useMemo<ChartData<"scatter">>(
    () => ({
      datasets: [
        {
          label: title,
          data: points.map((p) => ({ x: p.x, y: p.y })),
          backgroundColor: color,
          borderColor: color,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    }),
    [title, points, color],
  );

  const labels = useMemo(() => points.map((p) => p.label), [points]);

  const options = useMemo<ChartOptions<"scatter">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => labels[items[0]?.dataIndex ?? 0] ?? "",
            label: (ctx) =>
              `${xAxisLabel}: $${Number(ctx.parsed.x).toFixed(2)}, ${yAxisLabel}: $${Number(ctx.parsed.y).toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: xAxisLabel },
          ticks: { callback: (v) => `$${Number(v).toFixed(2)}` },
        },
        y: {
          type: "linear",
          title: { display: true, text: yAxisLabel },
          ticks: { callback: (v) => `$${Number(v).toFixed(2)}` },
        },
      },
    }),
    [labels, xAxisLabel, yAxisLabel],
  );

  return (
    <div style={{ height }}>
      <Scatter data={data} options={options} />
    </div>
  );
};

export const ModelIndex: React.FC = () => {
  const { llmModels, imageModels } = useModelsContext();
  const resolveColor = useColorResolver();

  const ioPoints = useMemo(
    () =>
      llmModels.map((m) => ({
        x: m.inputCost,
        y: m.outputCost,
        label: m.label,
      })),
    [llmModels],
  );

  const cachePoints = useMemo(
    () =>
      llmModels
        .filter((m) => m.cacheReadCost != null)
        .map((m) => ({
          x: m.cacheReadCost!,
          y: m.cacheReadCost!,
          label: m.label,
        })),
    [llmModels],
  );

  const sortedImageModels = useMemo(
    () => [...imageModels].sort((a, b) => a.cost - b.cost),
    [imageModels],
  );

  return (
    <Stack gap="md">
      <Title order={3}>Models Overview</Title>

      {llmModels.length > 0 && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Paper p="md" withBorder>
            <Text size="sm" fw={500} mb="sm">
              Input / Output Cost (per 1M tokens)
            </Text>
            <ScatterPanel
              title="Input / Output"
              points={ioPoints}
              color={resolveColor("blue.6")}
              xAxisLabel="Input ($)"
              yAxisLabel="Output ($)"
              height={300}
            />
          </Paper>

          {cachePoints.length > 0 && (
            <Paper p="md" withBorder>
              <Text size="sm" fw={500} mb="sm">
                Cache Read Cost (per 1M tokens)
              </Text>
              <ScatterPanel
                title="Cache Read"
                points={cachePoints}
                color={resolveColor("teal.6")}
                xAxisLabel="Cache Read ($)"
                yAxisLabel="Cache Read ($)"
                height={300}
              />
            </Paper>
          )}
        </SimpleGrid>
      )}

      {sortedImageModels.length > 0 && (
        <Paper p="md" withBorder>
          <Text size="sm" fw={500} mb="sm">
            Image Model Costs
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Model</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th ta="right">Cost</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sortedImageModels.map((model) => (
                <Table.Tr key={model.key}>
                  <Table.Td>{model.label}</Table.Td>
                  <Table.Td>{model.size}</Table.Td>
                  <Table.Td ta="right">${model.cost}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
};
