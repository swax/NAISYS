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
import { formatTokens, formatTokensLong, sumBy } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";
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
import { formatAgentLabel } from "../../lib/agentLabel";
import type { CostsHistogramResponse } from "../../lib/api/apiClient";
import { api, apiEndpoints } from "../../lib/api/apiClient";
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
  const [rangeHours, setRangeHours] = useState("168");
  const [bucketHours, setBucketHours] = useState<string | null>(null);
  const [leadUsername, setLeadUsername] = useState<string>("");
  const [groupBy, setGroupBy] = useState<"agent" | "model">("agent");
  const [metric, setMetric] = useState<"cost" | "tokens">("cost");
  // Fixed server config that arrives with the costs response. Mirrored into
  // state so effectiveBucketHours — and thus the query key — never depends on
  // this query's own result.
  const [spendLimitHours, setSpendLimitHours] = useState<number>();

  const formatCost = useCallback((n: number) => `$${n.toFixed(2)}`, []);

  const formatValue = useCallback(
    (n: number) => (metric === "cost" ? formatCost(n) : formatTokensLong(n)),
    [metric, formatCost],
  );
  const formatOther = useCallback(
    (n: number) => (metric === "cost" ? formatTokensLong(n) : formatCost(n)),
    [metric, formatCost],
  );
  const formatTick = useCallback(
    (n: number) => (metric === "cost" ? formatCost(n) : formatTokens(n)),
    [metric, formatCost],
  );
  const formatRate = useCallback(
    (cost: number, tokens: number) =>
      tokens > 0 ? `$${((cost * 1_000_000) / tokens).toFixed(2)}/Mtok` : null,
    [],
  );

  // Default to spend limit window on first load, then fall back to 24h
  const effectiveBucketHours = bucketHours
    ? parseFloat(bucketHours)
    : (spendLimitHours ?? 24);

  const costsQuery = useQuery({
    queryKey: ["costs", rangeHours, effectiveBucketHours, leadUsername],
    queryFn: () => {
      const now = new Date();
      const start = new Date(
        now.getTime() - parseFloat(rangeHours) * 60 * 60 * 1000,
      );
      return api.get<CostsHistogramResponse>(
        apiEndpoints.costs({
          start: start.toISOString(),
          end: now.toISOString(),
          bucketHours: effectiveBucketHours,
          leadUsername: leadUsername || undefined,
        }),
      );
    },
  });
  const data = costsQuery.data;
  const loading = costsQuery.isLoading;

  // spendLimitHours arrives with the costs response; mirror it into state so
  // effectiveBucketHours can default to it without the query keying on its
  // own result.
  useEffect(() => {
    if (
      data?.spendLimitHours != null &&
      data.spendLimitHours !== spendLimitHours
    ) {
      setSpendLimitHours(data.spendLimitHours);
    }
  }, [data, spendLimitHours]);

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

  const breakdownFor = useCallback(
    (bucket: CostsHistogramResponse["buckets"][number]) => {
      if (metric === "cost") {
        return groupBy === "agent" ? bucket.byAgent : bucket.byModel;
      }
      return groupBy === "agent" ? bucket.byAgentTokens : bucket.byModelTokens;
    },
    [groupBy, metric],
  );

  // Collect all unique series names across buckets, sorted by total desc
  const seriesNames = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    const totals = new Map<string, number>();
    for (const bucket of data.buckets) {
      const breakdown = breakdownFor(bucket);
      for (const [name, value] of Object.entries(breakdown)) {
        names.add(name);
        totals.set(name, (totals.get(name) ?? 0) + value);
      }
    }
    return Array.from(names).sort(
      (a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
    );
  }, [data, breakdownFor]);

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
      const breakdown = breakdownFor(bucket);
      for (const name of seriesNames) {
        const v = breakdown[name] ?? 0;
        row[name] =
          metric === "cost" ? Math.round(v * 100) / 100 : Math.round(v);
      }
      return row;
    });
  }, [data, bucketHours, seriesNames, breakdownFor, metric]);

  const titleMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.byAgent.map((a) => [a.username, a.title]));
  }, [data]);

  // Per-bucket values for the *other* metric, keyed by series name, used in
  // tooltips to show the secondary metric next to the primary.
  const secondaryByName = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!data) return map;
    for (const name of seriesNames) map.set(name, []);
    for (const bucket of data.buckets) {
      const otherBreakdown =
        metric === "cost"
          ? groupBy === "agent"
            ? bucket.byAgentTokens
            : bucket.byModelTokens
          : groupBy === "agent"
            ? bucket.byAgent
            : bucket.byModel;
      for (const name of seriesNames) {
        map.get(name)!.push(otherBreakdown[name] ?? 0);
      }
    }
    return map;
  }, [data, seriesNames, metric, groupBy]);

  const barChartData = useMemo<ChartData<"bar">>(() => {
    return {
      labels: chartData.map((d) => d.label as string),
      datasets: seriesNames.map((name, i) => {
        const title = groupBy === "agent" ? titleMap.get(name) : undefined;
        const color = resolveColor(
          AGENT_COLOR_TOKENS[i % AGENT_COLOR_TOKENS.length],
        );
        return {
          label: formatAgentLabel(name, title),
          data: chartData.map((d) => Number(d[name] ?? 0)),
          backgroundColor: color,
          maxBarThickness: 50,
          stack: "series",
        };
      }),
    };
  }, [chartData, seriesNames, titleMap, resolveColor, groupBy]);

  const totals = useMemo(() => {
    if (!data) return { cost: 0, tokens: 0 };
    return data.buckets.reduce(
      (acc, b) => ({ cost: acc.cost + b.cost, tokens: acc.tokens + b.tokens }),
      { cost: 0, tokens: 0 },
    );
  }, [data]);

  const pieEntries = useMemo<
    { label: string; cost: number; tokens: number }[]
  >(() => {
    if (!data) return [];
    if (groupBy === "agent") {
      return data.byAgent.map((e) => ({
        label: formatAgentLabel(e.username, e.title),
        cost: e.cost,
        tokens: e.tokens,
      }));
    }
    return data.byModel.map((e) => ({
      label: e.model,
      cost: e.cost,
      tokens: e.tokens,
    }));
  }, [data, groupBy]);

  const pieChartData = useMemo<ChartData<"pie">>(() => {
    if (!pieEntries.length) {
      return { labels: [], datasets: [{ data: [], backgroundColor: [] }] };
    }
    return {
      labels: pieEntries.map((e) => e.label),
      datasets: [
        {
          data: pieEntries.map((e) => (metric === "cost" ? e.cost : e.tokens)),
          backgroundColor: pieEntries.map((_, i) =>
            resolveColor(AGENT_COLOR_TOKENS[i % AGENT_COLOR_TOKENS.length]),
          ),
          borderWidth: 1,
        },
      ],
    };
  }, [pieEntries, resolveColor, metric]);

  // Show the spend limit reference line when bucket size matches the spend limit hours
  const showSpendLimitLine =
    metric === "cost" &&
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
            label: (ctx) => {
              const name = seriesNames[ctx.datasetIndex];
              const other = secondaryByName.get(name)?.[ctx.dataIndex] ?? 0;
              const primary = Number(ctx.parsed.y);
              const cost = metric === "cost" ? primary : other;
              const tokens = metric === "cost" ? other : primary;
              const rate = formatRate(cost, tokens);
              const base = `${ctx.dataset.label}: ${formatValue(
                primary,
              )} (${formatOther(other)})`;
              return rate ? `${base} · ${rate}` : base;
            },
            footer: (items) => {
              const totalPrimary = sumBy(items, (it) =>
                Number(it.parsed.y || 0),
              );
              const totalSecondary = sumBy(items, (it) => {
                const name = seriesNames[it.datasetIndex];
                return secondaryByName.get(name)?.[it.dataIndex] ?? 0;
              });
              const totalCost =
                metric === "cost" ? totalPrimary : totalSecondary;
              const totalTokens =
                metric === "cost" ? totalSecondary : totalPrimary;
              const rate = formatRate(totalCost, totalTokens);
              const base = `Total: ${formatValue(
                totalPrimary,
              )} (${formatOther(totalSecondary)})`;
              return rate ? `${base} · ${rate}` : base;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          ticks: { callback: (v) => formatTick(Number(v)) },
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
  }, [
    showSpendLimitLine,
    data?.spendLimitDollars,
    limitLineColor,
    formatValue,
    formatOther,
    formatTick,
    formatRate,
    metric,
    seriesNames,
    secondaryByName,
  ]);

  const pieOptions = useMemo<ChartOptions<"pie">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const entry = pieEntries[ctx.dataIndex];
              if (!entry) return `${ctx.label}: ${ctx.parsed}`;
              const primary = formatValue(
                metric === "cost" ? entry.cost : entry.tokens,
              );
              const other = formatOther(
                metric === "cost" ? entry.tokens : entry.cost,
              );
              const rate = formatRate(entry.cost, entry.tokens);
              const base = `${ctx.label}: ${primary} (${other})`;
              return rate ? `${base} · ${rate}` : base;
            },
          },
        },
      },
    }),
    [formatValue, formatOther, formatRate, pieEntries, metric],
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
              Total Cost (
              {TIME_RANGES.find((r) => r.value === rangeHours)?.label})
            </Text>
            <Text size="sm" fw={500}>
              {formatCost(totals.cost)}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Total Tokens (
              {TIME_RANGES.find((r) => r.value === rangeHours)?.label})
            </Text>
            <Text size="sm" fw={500}>
              {formatTokens(totals.tokens)}
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
              label: formatAgentLabel(a.name, a.title),
            }))}
            value={leadUsername || null}
            onChange={(v) => setLeadUsername(v ?? "")}
            clearable
            searchable
            size="xs"
          />
          <NativeSelect
            label="Group By"
            data={[
              { value: "agent", label: "Agent" },
              { value: "model", label: "Model" },
            ]}
            value={groupBy}
            onChange={(e) =>
              setGroupBy(e.currentTarget.value as "agent" | "model")
            }
            size="xs"
          />
          <NativeSelect
            label="Metric"
            data={[
              { value: "cost", label: "Cost ($)" },
              { value: "tokens", label: "Tokens" },
            ]}
            value={metric}
            onChange={(e) =>
              setMetric(e.currentTarget.value as "cost" | "tokens")
            }
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
            {pieEntries.length ? (
              <Paper p="md" withBorder>
                <Text size="sm" fw={500} mb="sm">
                  {metric === "cost" ? "Cost" : "Tokens"} by{" "}
                  {groupBy === "agent" ? "Agent" : "Model"}
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
