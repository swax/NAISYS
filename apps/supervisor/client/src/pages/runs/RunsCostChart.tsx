import type { ChartData, ChartOptions } from "chart.js";
import React, { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";

import { useColorResolver } from "../../lib/charts";
import type { RunSession } from "../../types/runSession";

interface RunsCostChartProps {
  runs: RunSession[];
  agentName: string;
}

export const RunsCostChart: React.FC<RunsCostChartProps> = ({
  runs,
  agentName,
}) => {
  const resolveColor = useColorResolver();
  const navigate = useNavigate();

  const sortedRuns = useMemo(
    () =>
      [...runs].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [runs],
  );

  const data = useMemo<ChartData<"line">>(() => {
    const color = resolveColor("blue.6");
    return {
      labels: sortedRuns.map((run) =>
        new Date(run.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      ),
      datasets: [
        {
          label: "Cost ($)",
          data: sortedRuns.map((run) => run.totalCost),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 1.5,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointHitRadius: 10,
          tension: 0,
          fill: false,
        },
      ],
    };
  }, [sortedRuns, resolveColor]);

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { left: 4, right: 4, top: 2, bottom: 2 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${Number(ctx.parsed.y).toFixed(2)}`,
          },
        },
      },
      onHover: (event, elements) => {
        const target = event.native?.target as HTMLElement | undefined;
        if (target) {
          target.style.cursor = elements.length > 0 ? "pointer" : "default";
        }
      },
      onClick: (_event, elements) => {
        if (elements.length === 0) return;
        const run = sortedRuns[elements[0].index];
        if (!run) return;
        void navigate(
          `/agents/${agentName}/runs/${run.runId}-${run.sessionId}`,
        );
      },
      scales: {
        x: { display: false },
        y: {
          display: true,
          grid: { display: false },
          border: { display: false },
          afterFit: (scale) => {
            scale.width = 0;
          },
          ticks: {
            font: { size: 9, weight: "bold" },
            maxTicksLimit: 3,
            mirror: true,
            padding: 2,
            z: 1,
            callback: (v) => `$${Number(v).toFixed(2)}`,
          },
        },
      },
    }),
    [sortedRuns, agentName, navigate],
  );

  if (runs.length === 0) return null;

  return (
    <div style={{ height: 60 }}>
      <Line data={data} options={options} />
    </div>
  );
};
