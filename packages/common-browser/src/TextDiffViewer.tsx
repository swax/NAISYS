import { Box, SegmentedControl, Stack, Text } from "@mantine/core";
import type { ChangeObject } from "diff";
import { diffLines } from "diff";
import { useMemo, useState } from "react";

import { InlineWordDiff } from "./InlineWordDiff.js";

export type DiffViewMode = "split" | "unified";

export interface TextDiffViewerProps {
  oldText: string;
  newText: string;
  oldLabel?: string;
  newLabel?: string;
  defaultMode?: DiffViewMode;
  showModeToggle?: boolean;
}

type RowType = "unchanged" | "added" | "removed" | "modified";
interface SplitRow {
  left?: string;
  right?: string;
  type: RowType;
}

function splitLines(value: string): string[] {
  const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value;
  return trimmed.split("\n");
}

function buildSplitRows(changes: ChangeObject<string>[]): SplitRow[] {
  const rows: SplitRow[] = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const lines = splitLines(c.value);

    if (!c.added && !c.removed) {
      for (const line of lines) {
        rows.push({ left: line, right: line, type: "unchanged" });
      }
      continue;
    }

    if (c.removed) {
      const next = changes[i + 1];
      if (next?.added) {
        const nextLines = splitLines(next.value);
        const max = Math.max(lines.length, nextLines.length);
        for (let j = 0; j < max; j++) {
          const left = lines[j];
          const right = nextLines[j];
          let type: RowType;
          if (left !== undefined && right !== undefined) type = "modified";
          else if (left !== undefined) type = "removed";
          else type = "added";
          rows.push({ left, right, type });
        }
        i++;
      } else {
        for (const line of lines) {
          rows.push({ left: line, type: "removed" });
        }
      }
      continue;
    }

    if (c.added) {
      for (const line of lines) {
        rows.push({ right: line, type: "added" });
      }
    }
  }
  return rows;
}

const ROW_BG: Record<RowType, { left: string; right: string }> = {
  unchanged: { left: "transparent", right: "transparent" },
  removed: { left: "var(--diff-bg-removed)", right: "var(--diff-bg-empty)" },
  added: { left: "var(--diff-bg-empty)", right: "var(--diff-bg-added)" },
  modified: { left: "var(--diff-bg-removed)", right: "var(--diff-bg-added)" },
};

const DIFF_VARS: React.CSSProperties = {
  // Mantine-theme-aware tints (work in light + dark)
  ["--diff-bg-removed" as never]:
    "light-dark(rgba(255, 99, 99, 0.18), rgba(255, 99, 99, 0.22))",
  ["--diff-bg-added" as never]:
    "light-dark(rgba(80, 200, 120, 0.18), rgba(80, 200, 120, 0.22))",
  ["--diff-bg-empty" as never]:
    "light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04))",
  ["--diff-border" as never]:
    "light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
  ["--diff-gutter" as never]:
    "light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))",
  ["--diff-gutter-text" as never]:
    "light-dark(var(--mantine-color-gray-6), var(--mantine-color-dark-2))",
};

const cellStyle: React.CSSProperties = {
  fontFamily: "var(--mantine-font-family-monospace)",
  fontSize: 12,
  lineHeight: "18px",
  padding: "0 8px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  verticalAlign: "top",
};

const gutterStyle: React.CSSProperties = {
  ...cellStyle,
  width: 44,
  minWidth: 44,
  textAlign: "right",
  color: "var(--diff-gutter-text)",
  background: "var(--diff-gutter)",
  userSelect: "none",
  borderRight: "1px solid var(--diff-border)",
};

const SplitView: React.FC<{
  rows: SplitRow[];
  oldLabel: string;
  newLabel: string;
}> = ({ rows, oldLabel, newLabel }) => {
  let leftLine = 0;
  let rightLine = 0;
  return (
    <Box
      style={{
        ...DIFF_VARS,
        border: "1px solid var(--diff-border)",
        borderRadius: 4,
        overflow: "auto",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th colSpan={2} style={headerStyle}>
              {oldLabel}
            </th>
            <th
              colSpan={2}
              style={{
                ...headerStyle,
                borderLeft: "1px solid var(--diff-border)",
              }}
            >
              {newLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.left !== undefined) leftLine++;
            if (row.right !== undefined) rightLine++;
            const bg = ROW_BG[row.type];
            const isMod =
              row.type === "modified" &&
              row.left !== undefined &&
              row.right !== undefined;
            return (
              <tr key={idx}>
                <td style={gutterStyle}>
                  {row.left !== undefined ? leftLine : ""}
                </td>
                <td style={{ ...cellStyle, background: bg.left }}>
                  {isMod ? (
                    <InlineWordDiff
                      oldText={row.left!}
                      newText={row.right!}
                      side="old"
                    />
                  ) : (
                    (row.left ?? "")
                  )}
                </td>
                <td
                  style={{
                    ...gutterStyle,
                    borderLeft: "1px solid var(--diff-border)",
                  }}
                >
                  {row.right !== undefined ? rightLine : ""}
                </td>
                <td style={{ ...cellStyle, background: bg.right }}>
                  {isMod ? (
                    <InlineWordDiff
                      oldText={row.left!}
                      newText={row.right!}
                      side="new"
                    />
                  ) : (
                    (row.right ?? "")
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  );
};

const headerStyle: React.CSSProperties = {
  ...cellStyle,
  fontSize: 11,
  fontWeight: 600,
  textAlign: "left",
  background: "var(--diff-gutter)",
  color: "var(--diff-gutter-text)",
  padding: "4px 8px",
  borderBottom: "1px solid var(--diff-border)",
};

const UnifiedView: React.FC<{ rows: SplitRow[] }> = ({ rows: splitRows }) => {
  let oldLine = 0;
  let newLine = 0;
  type UnifiedRow = {
    type: "unchanged" | "added" | "removed";
    line: string;
    oldNo?: number;
    newNo?: number;
    pairedLine?: string;
  };
  const rows: UnifiedRow[] = [];
  for (const r of splitRows) {
    if (r.type === "unchanged" && r.left !== undefined) {
      oldLine++;
      newLine++;
      rows.push({
        type: "unchanged",
        line: r.left,
        oldNo: oldLine,
        newNo: newLine,
      });
    } else if (
      r.type === "modified" &&
      r.left !== undefined &&
      r.right !== undefined
    ) {
      oldLine++;
      rows.push({
        type: "removed",
        line: r.left,
        oldNo: oldLine,
        pairedLine: r.right,
      });
      newLine++;
      rows.push({
        type: "added",
        line: r.right,
        newNo: newLine,
        pairedLine: r.left,
      });
    } else if (r.type === "removed" && r.left !== undefined) {
      oldLine++;
      rows.push({ type: "removed", line: r.left, oldNo: oldLine });
    } else if (r.type === "added" && r.right !== undefined) {
      newLine++;
      rows.push({ type: "added", line: r.right, newNo: newLine });
    }
  }
  return (
    <Box
      style={{
        ...DIFF_VARS,
        border: "1px solid var(--diff-border)",
        borderRadius: 4,
        overflow: "auto",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map((r, idx) => {
            const bg =
              r.type === "added"
                ? "var(--diff-bg-added)"
                : r.type === "removed"
                  ? "var(--diff-bg-removed)"
                  : "transparent";
            const prefix =
              r.type === "added" ? "+" : r.type === "removed" ? "-" : " ";
            return (
              <tr key={idx}>
                <td style={gutterStyle}>{r.oldNo ?? ""}</td>
                <td style={gutterStyle}>{r.newNo ?? ""}</td>
                <td
                  style={{
                    ...cellStyle,
                    background: bg,
                    width: 14,
                    minWidth: 14,
                    color: "var(--diff-gutter-text)",
                  }}
                >
                  {prefix}
                </td>
                <td style={{ ...cellStyle, background: bg }}>
                  {r.pairedLine !== undefined ? (
                    <InlineWordDiff
                      oldText={r.type === "removed" ? r.line : r.pairedLine}
                      newText={r.type === "removed" ? r.pairedLine : r.line}
                      side={r.type === "removed" ? "old" : "new"}
                    />
                  ) : (
                    r.line
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  );
};

export const TextDiffViewer: React.FC<TextDiffViewerProps> = ({
  oldText,
  newText,
  oldLabel = "Before",
  newLabel = "After",
  defaultMode = "split",
  showModeToggle = true,
}) => {
  const [mode, setMode] = useState<DiffViewMode>(defaultMode);

  const changes = useMemo(
    () => diffLines(oldText, newText),
    [oldText, newText],
  );
  const splitRows = useMemo(() => buildSplitRows(changes), [changes]);

  const hasChanges = changes.some((c) => c.added || c.removed);

  return (
    <Stack gap="xs">
      {showModeToggle && (
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => setMode(v as DiffViewMode)}
          data={[
            { label: "Side by side", value: "split" },
            { label: "Unified", value: "unified" },
          ]}
          style={{ alignSelf: "flex-start" }}
        />
      )}
      {!hasChanges ? (
        <Text size="sm" c="dimmed">
          No differences.
        </Text>
      ) : mode === "split" ? (
        <SplitView rows={splitRows} oldLabel={oldLabel} newLabel={newLabel} />
      ) : (
        <UnifiedView rows={splitRows} />
      )}
    </Stack>
  );
};
