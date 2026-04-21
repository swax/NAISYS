import { useComputedColorScheme, useMantineTheme } from "@mantine/core";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Title,
  Tooltip,
} from "chart.js";
import { useEffect } from "react";

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  Title,
  Tooltip,
);

/**
 * Resolve a Mantine color token like "blue.6" or "teal.5" to a hex string.
 * Pass-through for anything that doesn't look like a token.
 */
export function useColorResolver(): (token: string) => string {
  const theme = useMantineTheme();
  return (token: string) => {
    if (!token.includes(".")) return token;
    const [name, shadeStr] = token.split(".");
    const palette = theme.colors[name as keyof typeof theme.colors];
    const shade = Number(shadeStr);
    if (!palette || Number.isNaN(shade)) return token;
    return palette[shade] ?? token;
  };
}

/** Ordered palette used across charts to color series consistently. */
export const AGENT_COLOR_TOKENS = [
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
] as const;

/**
 * Sync Chart.js global defaults (text + grid colors) with the Mantine color
 * scheme. Canvas can't resolve CSS variables, so we set literal hex values.
 * Mount once near the app root.
 */
export function useChartThemeSync(): void {
  const colorScheme = useComputedColorScheme("dark");
  useEffect(() => {
    if (colorScheme === "dark") {
      Chart.defaults.color = "#c9c9c9";
      Chart.defaults.borderColor = "rgba(255, 255, 255, 0.12)";
    } else {
      Chart.defaults.color = "#212529";
      Chart.defaults.borderColor = "rgba(0, 0, 0, 0.12)";
    }
  }, [colorScheme]);
}
