import { Anchor, Box, Image, Stack, Text } from "@mantine/core";
import {
  ATTACHMENT_NO_ACCESS,
  formatFileSize,
  isImageFilename,
} from "@naisys/common";
import { IconFile } from "@tabler/icons-react";
import React from "react";

import type { LogEntry } from "../../lib/api/apiClient";
import { useImageGallery } from "./ImageGallery";

export const getLogColor = (log: LogEntry) => {
  if (log.type === "comment") return "green";
  if (log.type === "error") return "red";
  if (log.type === "compact") return "yellow";
  if (log.source === "llm" || log.source == "endPrompt") return "magenta";
  if (log.source === "startPrompt") return "white";
  return undefined;
};

export const formatLogTitle = (log: LogEntry) => {
  const date = new Date(log.createdAt).toLocaleString();
  return `ID: ${log.id}\nDate: ${date}\nType: ${log.type}\nSource: ${log.source}\nRole: ${log.role}`;
};

const NoAccessPlaceholder = "/supervisor/apple-touch-icon.png";

const LogAttachmentDisplay: React.FC<{ log: LogEntry }> = ({ log }) => {
  const { openImage } = useImageGallery();

  if (!log.attachment) return null;

  const att = log.attachment;

  if (att.id === ATTACHMENT_NO_ACCESS) {
    if (isImageFilename(att.filename)) {
      return (
        <Box mt={4}>
          <Image
            src={NoAccessPlaceholder}
            alt="Restricted attachment"
            maw={300}
            radius="sm"
            style={{ opacity: 0.6 }}
          />
          <Text size="xs" c="dimmed" mt={2}>
            {att.filename} (restricted)
          </Text>
        </Box>
      );
    }
    return (
      <Text
        size="xs"
        c="dimmed"
        mt={4}
        style={{ display: "flex", alignItems: "center", gap: 4 }}
      >
        <IconFile size={14} />
        {att.filename} (restricted)
      </Text>
    );
  }

  const downloadUrl = att.downloadUrl;

  if (isImageFilename(att.filename)) {
    return (
      <Box mt={4}>
        <Image
          src={downloadUrl}
          alt={att.filename}
          maw={300}
          radius="sm"
          style={{ cursor: "pointer" }}
          onClick={() => openImage(downloadUrl)}
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

export const LogEntryComponent: React.FC<{
  log: LogEntry;
  highlighted?: boolean;
}> = ({ log, highlighted }) => {
  return (
    <Stack
      gap={0}
      id={`log-${log.id}`}
      style={
        highlighted
          ? {
              backgroundColor: "rgba(66, 153, 225, 0.25)",
              transition: "background-color 0.6s ease-out",
              borderRadius: 4,
            }
          : undefined
      }
    >
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

export const GroupedLogComponent: React.FC<{
  item: LogEntry | LogEntry[];
  highlightedId?: number | null;
}> = ({ item, highlightedId }) => {
  if (Array.isArray(item)) {
    const groupHighlighted = item.some((log) => log.id === highlightedId);
    // The group's outer id matches the last entry (the endPrompt) since chat
    // bubble links target endPromptId. Each entry also gets its own anchor
    // so other consumers can scrollIntoView either id.
    const anchorId = item[item.length - 1].id;
    return (
      <Stack
        gap={0}
        id={`log-${anchorId}`}
        style={
          groupHighlighted
            ? {
                backgroundColor: "rgba(66, 153, 225, 0.25)",
                transition: "background-color 0.6s ease-out",
                borderRadius: 4,
              }
            : undefined
        }
      >
        <div style={{ display: "inline", margin: 0, padding: 0 }}>
          {item.map((log) => (
            <Text
              key={log.id}
              id={log.id === anchorId ? undefined : `log-${log.id}`}
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

  return (
    <LogEntryComponent log={item} highlighted={item.id === highlightedId} />
  );
};
