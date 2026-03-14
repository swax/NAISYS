import { BarChart, PieChart } from "@mantine/charts";
import {
  ColorSwatch,
  Container,
  Group,
  Loader,
  NativeSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentDataContext } from "../../contexts/AgentDataContext";
import type { CostsHistogramResponse } from "../../lib/apiClient";
import { api, apiEndpoints } from "../../lib/apiClient";

const TIME_RANGES = [
  { value: "24", label: "Last 24 hours" },
  { value: "72", label: "Last 3 days" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
  { value: "2160", label: "Last 90 days" },
];

const BASE_BUCKET_SIZES = [
  { value: "1", label: "1 hour" },
  { value: "3", label: "3 hours" },
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "1 day" },
  { value: "168", label: "1 week" },
];

const AGENT_COLORS = [
  "blue.6",
  "teal.6",
  "orange.6",
  "grape.6",
  "cyan.6",
  "pink.6",
  "lime.6",
  "violet.6",
  "yellow.6",
  "red.6",
];

export const CostsPage: React.FC = () => {
  const { agents } = useAgentDataContext();
  const [data, setData] = useState<CostsHistogramResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangeHours, setRangeHours] = useState("168");
  const [bucketHours, setBucketHours] = useState<string | null>(null);
  const [leadUsername, setLeadUsername] = useState<string>("");

  // Default to spend limit window on first load, then fall back to 24h
  const effectiveBucketHours = bucketHours
    ? parseFloat(bucketHours)
    : (data?.spendLimitHours ?? 24);

  // Annotate the bucket size that matches the spend limit window
  const bucketSizes = useMemo(() => {
    const limitHours = data?.spendLimitHours;
    if (limitHours == null) return BASE_BUCKET_SIZES;
    const limitStr = String(limitHours);
    const hasMatch = BASE_BUCKET_SIZES.some((b) => b.value === limitStr);
    const annotated = BASE_BUCKET_SIZES.map((b) =>
      b.value === limitStr
        ? { ...b, label: `${b.label} (spend limit window)` }
        : b,
    );
    if (!hasMatch) {
      annotated.unshift({
        value: limitStr,
        label: `${limitHours}h (spend limit window)`,
      });
    }
    return annotated;
  }, [data?.spendLimitHours]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const now = new Date();
      const start = new Date(
        now.getTime() - parseFloat(rangeHours) * 60 * 60 * 1000,
      );
      const result = await api.get<CostsHistogramResponse>(
        apiEndpoints.costs({
          start: start.toISOString(),
          end: now.toISOString(),
          bucketHours: effectiveBucketHours,
          leadUsername: leadUsername || undefined,
        }),
      );
      setData(result);
    } catch {
      // error handled silently
    } finally {
      setLoading(false);
    }
  }, [rangeHours, effectiveBucketHours, leadUsername]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Collect all unique agent names across buckets for series definition
  const agentNames = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    for (const bucket of data.buckets) {
      for (const name of Object.keys(bucket.byAgent)) {
        names.add(name);
      }
    }
    // Sort by total cost descending (matching byAgent order)
    const totals = new Map<string, number>();
    for (const bucket of data.buckets) {
      for (const [name, cost] of Object.entries(bucket.byAgent)) {
        totals.set(name, (totals.get(name) ?? 0) + cost);
      }
    }
    return Array.from(names).sort(
      (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
    );
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((bucket) => {
      const d = new Date(bucket.start);
      const bucketH = effectiveBucketHours;
      let label: string;
      if (bucketH >= 24) {
        label = d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
      } else {
        label = d.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          hour12: true,
        });
      }
      const row: Record<string, string | number> = { label };
      for (const name of agentNames) {
        row[name] = Math.round((bucket.byAgent[name] ?? 0) * 100) / 100;
      }
      return row;
    });
  }, [data, bucketHours, agentNames]);

  const titleMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.byAgent.map((a) => [a.username, a.title]));
  }, [data]);

  const barSeries = useMemo(() => {
    return agentNames.map((name, i) => {
      const title = titleMap.get(name);
      return {
        name,
        label: title ? `${name} (${title})` : name,
        color: AGENT_COLORS[i % AGENT_COLORS.length],
      };
    });
  }, [agentNames, titleMap]);

  const totalCost = useMemo(() => {
    if (!data) return 0;
    return data.buckets.reduce((sum, b) => sum + b.cost, 0);
  }, [data]);

  const pieData = useMemo(() => {
    if (!data?.byAgent.length) return [];
    return data.byAgent.map((entry, i) => ({
      name: `${entry.username} (${entry.title})`,
      value: entry.cost,
      color: AGENT_COLORS[i % AGENT_COLORS.length],
    }));
  }, [data]);

  // Show the spend limit reference line when bucket size matches the spend limit hours
  const showSpendLimitLine =
    data?.spendLimitDollars != null &&
    data?.spendLimitHours != null &&
    effectiveBucketHours === data.spendLimitHours;

  return (
    <Container size="lg" py="xl" w="100%">
      <Title order={2} mb="lg">
        Costs
      </Title>

      <Stack gap="md">
        {/* Spend limit settings */}
        <Group gap="xl">
          <div>
            <Text size="xs" c="dimmed">
              Spend Limit
            </Text>
            <Text size="sm" fw={500}>
              {data?.spendLimitDollars != null
                ? `$${data.spendLimitDollars}`
                : "Not set"}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Spend Limit Window
            </Text>
            <Text size="sm" fw={500}>
              {data?.spendLimitHours != null
                ? `${data.spendLimitHours} hours`
                : "Not set"}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Total ({TIME_RANGES.find((r) => r.value === rangeHours)?.label})
            </Text>
            <Text size="sm" fw={500}>
              ${totalCost.toFixed(2)}
            </Text>
          </div>
        </Group>

        {/* Controls */}
        <Group gap="md">
          <NativeSelect
            label="Time Range"
            data={TIME_RANGES}
            value={rangeHours}
            onChange={(e) => setRangeHours(e.currentTarget.value)}
            size="xs"
          />
          <NativeSelect
            label="Bucket Size"
            data={bucketSizes}
            value={String(effectiveBucketHours)}
            onChange={(e) => setBucketHours(e.currentTarget.value)}
            size="xs"
          />
          <Select
            label="Lead Filter"
            placeholder="All agents"
            data={agents.map((a) => ({
              value: a.name,
              label: `${a.name} (${a.title})`,
            }))}
            value={leadUsername || null}
            onChange={(v) => setLeadUsername(v ?? "")}
            clearable
            searchable
            size="xs"
          />
        </Group>

        {/* Charts */}
        {loading ? (
          <Stack align="center" py="xl">
            <Loader />
          </Stack>
        ) : chartData.length > 0 ? (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Paper p="md" withBorder>
              <BarChart
                h={350}
                data={chartData}
                dataKey="label"
                series={barSeries}
                type="stacked"
                valueFormatter={(value: number) => `$${value.toFixed(2)}`}
                tickLine="y"
                gridAxis="y"
                barProps={{ maxBarSize: 50 }}
                tooltipProps={{
                  content: ({ payload, label }) => {
                    if (!payload?.length) return null;
                    const items = payload
                      .filter((p: { value?: number }) => (p.value ?? 0) > 0)
                      .sort(
                        (a: { value?: number }, b: { value?: number }) =>
                          (b.value ?? 0) - (a.value ?? 0),
                      );
                    if (!items.length) return null;
                    const total = items.reduce(
                      (s: number, p: { value?: number }) => s + (p.value ?? 0),
                      0,
                    );
                    return (
                      <Paper
                        p="xs"
                        withBorder
                        shadow="sm"
                        style={{ background: "var(--mantine-color-body)" }}
                      >
                        <Text size="xs" fw={500} mb={4}>
                          {label as string}
                        </Text>
                        {items.map(
                          (p: {
                            name?: string;
                            value?: number;
                            color?: string;
                          }) => {
                            const title = titleMap.get(p.name ?? "");
                            const displayName = title
                              ? `${p.name} (${title})`
                              : p.name;
                            return (
                              <Group key={p.name} gap={6}>
                                <ColorSwatch
                                  color={p.color ?? "gray"}
                                  size={10}
                                />
                                <Text size="xs">
                                  {displayName}: ${(p.value ?? 0).toFixed(2)}
                                </Text>
                              </Group>
                            );
                          },
                        )}
                        <Text size="xs" fw={500} mt={4}>
                          Total: ${total.toFixed(2)}
                        </Text>
                      </Paper>
                    );
                  },
                }}
                cursorFill="transparent"
                referenceLines={
                  showSpendLimitLine
                    ? [
                        {
                          y: data!.spendLimitDollars!,
                          color: "red.5",
                          label: `Limit: $${data!.spendLimitDollars}`,
                          labelPosition: "insideTopRight",
                        },
                      ]
                    : undefined
                }
              />
              {showSpendLimitLine && (
                <Text size="xs" c="red" mt="xs">
                  Dashed line: ${data!.spendLimitDollars} spend limit per{" "}
                  {data!.spendLimitHours}h window
                </Text>
              )}
            </Paper>
            {pieData.length > 0 && (
              <Paper p="md" withBorder>
                <Text size="sm" fw={500} mb="sm">
                  Cost by Agent
                </Text>
                <PieChart
                  h={350}
                  data={pieData}
                  withTooltip
                  tooltipDataSource="segment"
                  valueFormatter={(value: number) => `$${value.toFixed(2)}`}
                />
              </Paper>
            )}
          </SimpleGrid>
        ) : (
          <Text c="dimmed" ta="center" py="xl">
            No cost data for this time range.
          </Text>
        )}
      </Stack>
    </Container>
  );
};
