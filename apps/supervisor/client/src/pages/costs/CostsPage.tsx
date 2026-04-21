import {
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
import type {
  Chart,
  ChartData,
  ChartOptions,
  ChartType,
  Plugin,
} from "chart.js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, Pie } from "react-chartjs-2";

import { useAgentDataContext } from "../../contexts/AgentDataContext";
import type { CostsHistogramResponse } from "../../lib/apiClient";
import { api, apiEndpoints } from "../../lib/apiClient";
import { AGENT_COLOR_TOKENS, useColorResolver } from "../../lib/charts";
import { useBoomGuard } from "../../lib/useBoomGuard";

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

interface SpendLimitLineOptions {
  value: number;
  color: string;
  label: string;
}

declare module "chart.js" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    spendLimitLine?: SpendLimitLineOptions;
  }
}

const spendLimitLinePlugin: Plugin<"bar"> = {
  id: "spendLimitLine",
  afterDatasetsDraw(chart: Chart) {
    const opts = chart.options.plugins?.spendLimitLine;
    if (!opts || opts.value == null || !opts.color || !opts.label) return;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y?.getPixelForValue(opts.value);
    if (y == null || y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opts.color;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(opts.label, chartArea.right - 4, y - 2);
    ctx.restore();
  },
};

export const CostsPage: React.FC = () => {
  useBoomGuard("costs");
  const { agents } = useAgentDataContext();
  const resolveColor = useColorResolver();
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

  const barChartData = useMemo<ChartData<"bar">>(() => {
    return {
      labels: chartData.map((d) => d.label as string),
      datasets: agentNames.map((name, i) => {
        const title = titleMap.get(name);
        const color = resolveColor(
          AGENT_COLOR_TOKENS[i % AGENT_COLOR_TOKENS.length],
        );
        return {
          label: title ? `${name} (${title})` : name,
          data: chartData.map((d) => Number(d[name] ?? 0)),
          backgroundColor: color,
          maxBarThickness: 50,
          stack: "agents",
        };
      }),
    };
  }, [chartData, agentNames, titleMap, resolveColor]);

  const totalCost = useMemo(() => {
    if (!data) return 0;
    return data.buckets.reduce((sum, b) => sum + b.cost, 0);
  }, [data]);

  const pieChartData = useMemo<ChartData<"pie">>(() => {
    if (!data?.byAgent.length) {
      return { labels: [], datasets: [{ data: [], backgroundColor: [] }] };
    }
    return {
      labels: data.byAgent.map((e) => `${e.username} (${e.title})`),
      datasets: [
        {
          data: data.byAgent.map((e) => e.cost),
          backgroundColor: data.byAgent.map((_, i) =>
            resolveColor(AGENT_COLOR_TOKENS[i % AGENT_COLOR_TOKENS.length]),
          ),
          borderWidth: 1,
        },
      ],
    };
  }, [data, resolveColor]);

  // Show the spend limit reference line when bucket size matches the spend limit hours
  const showSpendLimitLine =
    data?.spendLimitDollars != null &&
    data?.spendLimitHours != null &&
    effectiveBucketHours === data.spendLimitHours;

  const limitLineColor = resolveColor("red.5");

  const barOptions = useMemo<ChartOptions<"bar">>(() => {
    const opts: ChartOptions<"bar"> = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          itemSort: (a, b) => Number(b.parsed.y) - Number(a.parsed.y),
          filter: (item) => Number(item.parsed.y) > 0,
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: $${Number(ctx.parsed.y).toFixed(2)}`,
            footer: (items) => {
              const total = items.reduce(
                (s, it) => s + Number(it.parsed.y || 0),
                0,
              );
              return `Total: $${total.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          ticks: { callback: (v) => `$${Number(v).toFixed(2)}` },
        },
      },
    };
    if (showSpendLimitLine && data?.spendLimitDollars != null && opts.plugins) {
      opts.plugins.spendLimitLine = {
        value: data.spendLimitDollars,
        color: limitLineColor,
        label: `Limit: $${data.spendLimitDollars}`,
      };
    }
    return opts;
  }, [showSpendLimitLine, data?.spendLimitDollars, limitLineColor]);

  const pieOptions = useMemo<ChartOptions<"pie">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: $${Number(ctx.parsed).toFixed(2)}`,
          },
        },
      },
    }),
    [],
  );

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
              <div style={{ height: 350 }}>
                <Bar
                  data={barChartData}
                  options={barOptions}
                  plugins={[spendLimitLinePlugin]}
                />
              </div>
              {showSpendLimitLine && (
                <Text size="xs" c="red" mt="xs">
                  Dashed line: ${data!.spendLimitDollars} spend limit per{" "}
                  {data!.spendLimitHours}h window
                </Text>
              )}
            </Paper>
            {data?.byAgent.length ? (
              <Paper p="md" withBorder>
                <Text size="sm" fw={500} mb="sm">
                  Cost by Agent
                </Text>
                <div style={{ height: 350 }}>
                  <Pie data={pieChartData} options={pieOptions} />
                </div>
              </Paper>
            ) : null}
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
