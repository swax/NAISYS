import type { ThreadRunCommand } from "../../hooks/thread-runs/useThreadRunCommands";

export const firstLine = (s: string) => {
  const idx = s.indexOf("\n");
  return idx === -1 ? s : s.slice(0, idx);
};

const TOOLTIP_MAX_CHARS = 2000;
export const tooltipText = (s: string) =>
  s.length > TOOLTIP_MAX_CHARS
    ? `${s.slice(0, TOOLTIP_MAX_CHARS)}\n…(truncated, ${s.length - TOOLTIP_MAX_CHARS} more chars — click to view)`
    : s;

export const runLogPath = (cmd: ThreadRunCommand) => {
  const base = `/agents/${cmd.username}/runs/${cmd.runId}`;
  const tail = `/sessions/${cmd.sessionId}?focusLogId=${cmd.logId}`;
  return cmd.subagentId !== null && cmd.subagentId !== 0
    ? `${base}/subagents/${cmd.subagentId}${tail}`
    : `${base}${tail}`;
};

export const formatTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString();
};

export const ownStyle = {
  backgroundColor: "var(--mantine-color-blue-filled)" as const,
};

export const otherStyle = {
  backgroundColor: "var(--mantine-color-dark-5)" as const,
};
