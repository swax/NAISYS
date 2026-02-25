import type { ScatterChartSeries } from "@mantine/charts";
import { ScatterChart } from "@mantine/charts";
import { Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import React, { useMemo } from "react";

import { useModelsContext } from "./ModelsLayout";

/** Map from "seriesName:index" to model label, used by the custom tooltip */
type LabelMap = Map<string, string>;

function buildLabelKey(seriesName: string, idx: number) {
  return `${seriesName}:${idx}`;
}

interface ScatterTooltipProps {
  labelMap: LabelMap;
  xLabel: string;
  yLabel: string;
  payload?: ReadonlyArray<{ payload?: Record<string, unknown> }>;
}

const ScatterTooltip: React.FC<ScatterTooltipProps> = ({
  labelMap,
  xLabel,
  yLabel,
  payload,
}) => {
  if (!payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const seriesName = String(point.name ?? "");
  const idx = Number(point.idx ?? 0);
  const modelLabel = labelMap.get(buildLabelKey(seriesName, idx)) ?? "";

  return (
    <Paper
      p="xs"
      withBorder
      shadow="sm"
      style={{ background: "var(--mantine-color-body)" }}
    >
      <Text size="sm" fw={500}>
        {modelLabel}
      </Text>
      <Text size="xs">
        {xLabel}: ${Number(point.x).toFixed(2)}
      </Text>
      <Text size="xs">
        {yLabel}: ${Number(point.y).toFixed(2)}
      </Text>
    </Paper>
  );
};

export const ModelIndex: React.FC = () => {
  const { llmModels, imageModels } = useModelsContext();

  const { ioData, ioLabelMap, cacheData, cacheLabelMap } = useMemo(() => {
    const ioLabels: LabelMap = new Map();
    const cacheLabels: LabelMap = new Map();

    const ioName = "Input / Output";
    const ioSeries: ScatterChartSeries[] = [
      {
        name: ioName,
        color: "blue.6",
        data: llmModels.map((m, i) => {
          ioLabels.set(buildLabelKey(ioName, i), m.label);
          return { x: m.inputCost, y: m.outputCost, idx: i };
        }),
      },
    ];

    const cacheName = "Cache Read";
    const cacheModels = llmModels.filter(
      (m) => m.cacheReadCost != null,
    );
    const cacheSeries: ScatterChartSeries[] =
      cacheModels.length > 0
        ? [
            {
              name: cacheName,
              color: "teal.6",
              data: cacheModels.map((m, i) => {
                cacheLabels.set(buildLabelKey(cacheName, i), m.label);
                return { x: m.cacheReadCost!, y: m.cacheReadCost!, idx: i };
              }),
            },
          ]
        : [];

    return {
      ioData: ioSeries,
      ioLabelMap: ioLabels,
      cacheData: cacheSeries,
      cacheLabelMap: cacheLabels,
    };
  }, [llmModels]);

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
            <ScatterChart
              h={300}
              data={ioData}
              dataKey={{ x: "x", y: "y" }}
              xAxisLabel="Input ($)"
              yAxisLabel="Output ($)"
              valueFormatter={(value: number) => `$${value.toFixed(2)}`}
              tooltipProps={{
                content: ({
                  payload,
                }: {
                  payload?: ReadonlyArray<{
                    payload?: Record<string, unknown>;
                  }>;
                }) => (
                  <ScatterTooltip
                    labelMap={ioLabelMap}
                    xLabel="Input"
                    yLabel="Output"
                    payload={payload}
                  />
                ),
              }}
            />
          </Paper>

          {cacheData.length > 0 && (
            <Paper p="md" withBorder>
              <Text size="sm" fw={500} mb="sm">
                Cache Read Cost (per 1M tokens)
              </Text>
              <ScatterChart
                h={300}
                data={cacheData}
                dataKey={{ x: "x", y: "y" }}
                xAxisLabel="Cache Read ($)"
                yAxisLabel="Cache Read ($)"
                valueFormatter={(value: number) => `$${value.toFixed(2)}`}
                tooltipProps={{
                  content: ({
                    payload,
                  }: {
                    payload?: ReadonlyArray<{
                      payload?: Record<string, unknown>;
                    }>;
                  }) => (
                    <ScatterTooltip
                      labelMap={cacheLabelMap}
                      xLabel="Cache Read"
                      yLabel="Cache Read"
                      payload={payload}
                    />
                  ),
                }}
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
