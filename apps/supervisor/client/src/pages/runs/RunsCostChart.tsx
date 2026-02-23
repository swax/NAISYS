import { LineChart } from "@mantine/charts";
import { Paper } from "@mantine/core";
import React, { useMemo } from "react";

import { RunSession } from "../../types/runSession";

interface RunsCostChartProps {
  runs: RunSession[];
}

export const RunsCostChart: React.FC<RunsCostChartProps> = ({ runs }) => {
  const chartData = useMemo(() => {
    // Sort runs by createdAt (oldest to newest)
    const sortedRuns = [...runs].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Transform the data for the chart
    return sortedRuns.map((run) => ({
      date: new Date(run.createdAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      cost: run.totalCost,
    }));
  }, [runs]);

  if (runs.length === 0) {
    return null;
  }

  return (
    <Paper p="md" withBorder>
      <LineChart
        h={100}
        data={chartData}
        dataKey="date"
        series={[{ name: "cost", label: "Cost ($)", color: "blue.6" }]}
        curveType="linear"
        withTooltip
        tooltipProps={{
          position: { y: -160 },
        }}
        withDots
        gridAxis="none"
        valueFormatter={(value: number) => `$${value.toFixed(2)}`}
      />
    </Paper>
  );
};
