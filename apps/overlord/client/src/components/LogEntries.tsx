import { Text } from "@mantine/core";
import React from "react";
import { LogEntry } from "../lib/apiClient";

export const getLogColor = (log: LogEntry) => {
  if (log.type === "comment") return "green";
  if (log.type === "error") return "red";
  if (log.source === "llm" || log.source == "endPrompt") return "magenta";
  if (log.source === "startPrompt") return "white";
  return undefined;
};

export const formatLogTitle = (log: LogEntry) => {
  const date = new Date(log.date).toLocaleString();
  return `Date: ${date}\nType: ${log.type}\nSource: ${log.source}\nRole: ${log.role}`;
};

export const LogEntryComponent: React.FC<{ log: LogEntry }> = ({ log }) => {
  return (
    <Text
      size="sm"
      c={getLogColor(log)}
      title={formatLogTitle(log)}
      style={{
        fontFamily: "monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        padding: 0,
      }}
    >
      {log.message}
    </Text>
  );
};

export const groupPromptEntries = (
  logs: LogEntry[],
): (LogEntry | LogEntry[])[] => {
  const grouped: (LogEntry | LogEntry[])[] = [];
  let i = 0;

  while (i < logs.length) {
    const current = logs[i];

    if (current.source === "startPrompt") {
      const group = [current];
      let j = i + 1;

      // Find the corresponding endPrompt (should be next immediate entry)
      if (j < logs.length && logs[j].source === "endPrompt") {
        group.push(logs[j]);
        j++;
      }

      grouped.push(group);
      i = j;
    } else {
      grouped.push(current);
      i++;
    }
  }

  return grouped;
};

export const GroupedLogComponent: React.FC<{ item: LogEntry | LogEntry[] }> = ({
  item,
}) => {
  if (Array.isArray(item)) {
    return (
      <div style={{ display: "inline", margin: 0, padding: 0 }}>
        {item.map((log) => (
          <Text
            key={log.id}
            size="sm"
            c={getLogColor(log)}
            component="span"
            title={formatLogTitle(log)}
            style={{
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              padding: 0,
            }}
          >
            {log.message}
          </Text>
        ))}
      </div>
    );
  }

  return <LogEntryComponent log={item} />;
};
