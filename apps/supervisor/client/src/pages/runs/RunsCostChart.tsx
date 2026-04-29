import type { ChartData, ChartOptions } from "chart.js";
import React, { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { useNavigate } from "react-router-dom";

import { useColorResolver } from "../../lib/charts";
import type { RunSession } from "../../types/runSession";
import { runUrl } from "./RunsSidebar";

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

  const sortedRuns = useMemo<RunSession[]>(() => {
    // Roll ephemeral subagent costs into the parent session whose createdAt
    // is the latest one at or before the subagent's createdAt. With one
    // parent session per run (the common case) all subagent costs land on
    // that single session.
    const parents = runs.filter((r) => r.subagentId == null);

    const parentsByRun = new Map<string, RunSession[]>();
    for (const p of parents) {
      const key = `${p.userId}-${p.runId}`;
      const list = parentsByRun.get(key);
      if (list) list.push(p);
      else parentsByRun.set(key, [p]);
    }
    for (const list of parentsByRun.values()) {
      list.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    }

    const surcharge = new Map<string, number>();
    for (const sub of runs) {
      if (sub.subagentId == null) continue;
      const list = parentsByRun.get(`${sub.userId}-${sub.runId}`);
      if (!list || list.length === 0) continue;
      const subTime = new Date(sub.createdAt).getTime();
      let target = list[0];
      for (const p of list) {
        if (new Date(p.createdAt).getTime() <= subTime) target = p;
        else break;
      }
      const sessionKey = `${target.userId}-${target.runId}-${target.sessionId}`;
      surcharge.set(
        sessionKey,
        (surcharge.get(sessionKey) ?? 0) + sub.totalCost,
      );
    }

    const rolledUp = parents.map((p) => {
      const extra = surcharge.get(`${p.userId}-${p.runId}-${p.sessionId}`);
      return extra ? { ...p, totalCost: p.totalCost + extra } : p;
    });

    return rolledUp.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [runs]);

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
        void navigate(runUrl(agentName, run));
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

  if (sortedRuns.length === 0) return null;

  return (
    <div style={{ height: 60 }}>
      <Line data={data} options={options} />
    </div>
  );
};
