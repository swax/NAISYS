import { Anchor, Box, Image, Stack, Text } from "@mantine/core";
import { formatFileSize } from "@naisys/common";
import { IconFile } from "@tabler/icons-react";
import React from "react";

import { API_BASE, apiEndpoints, LogEntry } from "../../lib/apiClient";

function isImageFilename(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(filename);
}

export const getLogColor = (log: LogEntry) => {
  if (log.type === "comment") return "green";
  if (log.type === "error") return "red";
  if (log.source === "llm" || log.source == "endPrompt") return "magenta";
  if (log.source === "startPrompt") return "white";
  return undefined;
};

export const formatLogTitle = (log: LogEntry) => {
  const date = new Date(log.createdAt).toLocaleString();
  return `ID: ${log.id}\nDate: ${date}\nType: ${log.type}\nSource: ${log.source}\nRole: ${log.role}`;
};

const LogAttachmentDisplay: React.FC<{ log: LogEntry }> = ({ log }) => {
  if (!log.attachment) return null;

  const att = log.attachment;
  const downloadUrl = `${API_BASE}${apiEndpoints.attachmentDownload(att.id)}`;

  if (isImageFilename(att.filename)) {
    return (
      <Box mt={4}>
        <Image
          src={downloadUrl}
          alt={att.filename}
          maw={300}
          radius="sm"
          style={{ cursor: "pointer" }}
          onClick={() => window.open(downloadUrl, "_blank")}
        />
        <Text size="xs" c="dimmed" mt={2}>
          {att.filename} ({formatFileSize(att.fileSize)})
        </Text>
      </Box>
    );
  }

  return (
    <Anchor
      href={downloadUrl}
      download
      size="xs"
      mt={4}
      style={{ display: "flex", alignItems: "center", gap: 4 }}
    >
      <IconFile size={14} />
      {att.filename} ({formatFileSize(att.fileSize)})
    </Anchor>
  );
};

export const LogEntryComponent: React.FC<{ log: LogEntry }> = ({ log }) => {
  return (
    <Stack gap={0}>
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
      <LogAttachmentDisplay log={log} />
    </Stack>
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
      <Stack gap={0}>
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
        {item.map(
          (log) =>
            log.attachment && (
              <LogAttachmentDisplay key={`att-${log.id}`} log={log} />
            ),
        )}
      </Stack>
    );
  }

  return <LogEntryComponent log={item} />;
};
