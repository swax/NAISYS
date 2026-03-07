import { LineChart } from "@mantine/charts";
import {
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import React, { useMemo, useState } from "react";

import { useModelsContext } from "./ModelsLayout";

function sessionCost({
  sessionSize,
  avgOutput,
  avgInput,
  outputPrice,
  inputPrice,
  cacheReadPrice = 0,
  cacheWritePrice,
}: {
  sessionSize: number;
  avgOutput: number;
  avgInput: number;
  outputPrice: number;
  inputPrice: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
}) {
  const effectiveCacheWritePrice = cacheWritePrice ?? inputPrice;

  const c = avgInput + avgOutput;
  const N = Math.floor(sessionSize / c);

  const perM = 1_000_000;

  const cacheReads = (c * N * (N - 1)) / 2;
  const writes = c * N;
  const output = avgOutput * N;

  const cost =
    (cacheReads * (cacheReadPrice || inputPrice)) / perM +
    (writes * (cacheReadPrice ? effectiveCacheWritePrice : inputPrice)) / perM +
    (output * outputPrice) / perM;

  return {
    turns: N,
    cacheReads,
    writes,
    output,
    cost: Math.round(cost * 100) / 100,
  };
}

export const ModelCalculator: React.FC = () => {
  const { llmModels } = useModelsContext();

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [sessionSize, setSessionSize] = useState<number | string>(20000);
  const [avgResponseSize, setAvgResponseSize] = useState<number | string>(2000);
  const [avgMessageSize, setAvgMessageSize] = useState<number | string>(100);

  const modelOptions = llmModels.map((m) => ({
    value: m.key,
    label: m.label,
  }));

  const model = llmModels.find((m) => m.key === selectedModel);

  const result = useMemo(() => {
    if (!model) return null;
    const session = Number(sessionSize) || 0;
    const output = Number(avgResponseSize) || 0;
    const input = Number(avgMessageSize) || 0;
    if (session <= 0 || input + output <= 0) return null;

    return sessionCost({
      sessionSize: session,
      avgOutput: output,
      avgInput: input,
      outputPrice: model.outputCost,
      inputPrice: model.inputCost,
      cacheReadPrice: model.cacheReadCost ?? 0,
      cacheWritePrice: model.cacheWriteCost,
    });
  }, [model, sessionSize, avgResponseSize, avgMessageSize]);

  const chartData = useMemo(() => {
    if (!model) return [];
    const output = Number(avgResponseSize) || 0;
    const input = Number(avgMessageSize) || 0;
    if (input + output <= 0) return [];

    const maxSession = model.maxTokens;
    const steps = 20;
    const stepSize = Math.max(1, Math.floor(maxSession / steps));

    const points: { session: string; cost: number }[] = [];
    for (let s = stepSize; s <= maxSession; s += stepSize) {
      const r = sessionCost({
        sessionSize: s,
        avgOutput: output,
        avgInput: input,
        outputPrice: model.outputCost,
        inputPrice: model.inputCost,
        cacheReadPrice: model.cacheReadCost ?? 0,
        cacheWritePrice: model.cacheWriteCost,
      });
      points.push({
        session: `${Math.round(s / 1000)}k`,
        cost: r.cost,
      });
    }
    return points;
  }, [model, avgResponseSize, avgMessageSize]);

  return (
    <Stack gap="md" maw={400}>
      <Title order={3}>Cost Calculator</Title>
      <Text size="sm" c="dimmed">
        Estimate the cost of a session based on its total size and average
        message and response lengths. Models with cache pricing will
        automatically factor in cache read and write costs.
      </Text>

      <Select
        label="Model"
        placeholder="Select a model"
        data={modelOptions}
        value={selectedModel}
        onChange={setSelectedModel}
        searchable
      />

      <NumberInput
        label="Session Size (tokens)"
        value={sessionSize}
        onChange={setSessionSize}
        min={0}
        step={1000}
        thousandSeparator=","
      />

      <NumberInput
        label="Avg Response Size (tokens)"
        value={avgResponseSize}
        onChange={setAvgResponseSize}
        min={0}
        step={100}
        thousandSeparator=","
      />

      <NumberInput
        label="Avg Message Size (tokens)"
        value={avgMessageSize}
        onChange={setAvgMessageSize}
        min={0}
        step={100}
        thousandSeparator=","
      />

      {result && (
        <Paper p="md" withBorder>
          <Table>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>Turns</Table.Td>
                <Table.Td ta="right">{result.turns.toLocaleString()}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Session Cost</Table.Td>
                <Table.Td ta="right">${result.cost.toFixed(2)}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Cache Reads</Table.Td>
                <Table.Td ta="right">
                  {result.cacheReads.toLocaleString()} tokens
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Writes</Table.Td>
                <Table.Td ta="right">
                  {result.writes.toLocaleString()} tokens
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>Output</Table.Td>
                <Table.Td ta="right">
                  {result.output.toLocaleString()} tokens
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      {chartData.length > 0 && (
        <Paper p="md" withBorder>
          <Text size="sm" fw={500} mb="sm">
            Cost by Session Size
          </Text>
          <LineChart
            h={200}
            data={chartData}
            dataKey="session"
            series={[{ name: "cost", color: "blue.6", label: "Cost ($)" }]}
            curveType="natural"
            valueFormatter={(value: number) => `$${value.toFixed(2)}`}
            xAxisLabel="Session Size"
            yAxisLabel="Cost ($)"
          />
        </Paper>
      )}
    </Stack>
  );
};
