import {
  Anchor,
  Box,
  Container,
  Divider,
  Group,
  Image,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { formatFileSize } from "@naisys/common";
import { IconCheck, IconChecks, IconFile } from "@tabler/icons-react";
import React, { useRef } from "react";

import { CompactMarkdown } from "../../components/CompactMarkdown";
import type { MailMessage } from "../../lib/apiClient";
import { API_BASE, apiEndpoints } from "../../lib/apiClient";

function isImageFilename(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(filename);
}

interface MailThreadProps {
  messages: MailMessage[];
  currentAgentName: string;
  lastReadMailId: number | null;
  showSubject?: boolean;
}

export const MailThread: React.FC<MailThreadProps> = ({
  messages,
  currentAgentName,
  lastReadMailId,
  showSubject,
}) => {
  const viewport = useRef<HTMLDivElement>(null);

  if (messages.length === 0) {
    return (
      <Box
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text c="dimmed">No messages in this conversation</Text>
      </Box>
    );
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString();
  };

  // Display newest first
  const sortedMessages = [...messages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  // Track date dividers
  let lastDate = "";
  // Track whether we've shown the new mail divider (appears after the last read message, i.e. below it in newest-first order)
  let newMailDividerShown = false;

  return (
    <ScrollArea style={{ flex: 1 }} viewportRef={viewport}>
      <Container size="md" w="100%" p="md">
      <Stack gap="sm">
        {sortedMessages.map((msg, index) => {
          const isOwn = msg.fromUsername === currentAgentName;
          const msgDate = formatDate(msg.createdAt);
          const showDateDivider = msgDate !== lastDate;
          lastDate = msgDate;

          const recipientNames = msg.recipients.map((r) => r.username);

          // In newest-first order, show divider after the newest unread message
          // i.e. between msg.id > lastReadMailId and msg.id <= lastReadMailId
          const nextMsg = sortedMessages[index + 1];
          const showNewMailDivider =
            !newMailDividerShown &&
            lastReadMailId !== null &&
            msg.id > lastReadMailId &&
            nextMsg &&
            nextMsg.id <= lastReadMailId;
          if (showNewMailDivider) {
            newMailDividerShown = true;
          }

          return (
            <React.Fragment key={msg.id}>
              {showDateDivider && (
                <Text size="xs" c="dimmed" ta="center" py="xs">
                  {msgDate}
                </Text>
              )}
              <Paper
                p="sm"
                radius="sm"
                withBorder
                style={{
                  borderLeft: `3px solid var(--mantine-color-${isOwn ? "blue" : "gray"}-filled)`,
                }}
              >
                {/* Header: From / To + timestamp */}
                <Group justify="space-between" align="flex-start" mb={4}>
                  <Box style={{ minWidth: 0, flex: 1 }}>
                    <Text size="xs" c="dimmed">
                      <Text
                        component="span"
                        fw={600}
                        c={isOwn ? "blue" : undefined}
                        size="xs"
                      >
                        {msg.fromUsername}
                      </Text>
                      {" → "}
                      {recipientNames.join(", ")}
                    </Text>
                  </Box>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {formatTime(msg.createdAt)}
                    {isOwn &&
                      (msg.recipients.some((r) => r.readAt) ? (
                        <IconChecks
                          size={14}
                          color="var(--mantine-color-blue-filled)"
                          title="Read"
                        />
                      ) : (
                        <IconCheck
                          size={14}
                          color="var(--mantine-color-dimmed)"
                          title="Delivered"
                        />
                      ))}
                  </Text>
                </Group>

                {/* Subject line */}
                {showSubject && (
                  <Text size="sm" fw={600} mb={4}>
                    {msg.subject}
                  </Text>
                )}

                {/* Body */}
                <Text
                  size="sm"
                  style={{
                    wordBreak: "break-word",
                  }}
                >
                  <CompactMarkdown>{msg.body}</CompactMarkdown>
                </Text>

                {/* Attachments */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <Stack gap={4} mt="xs">
                    {msg.attachments.map((att) => {
                      const downloadUrl = `${API_BASE}${apiEndpoints.attachmentDownload(att.id)}`;
                      if (isImageFilename(att.filename)) {
                        return (
                          <Box key={att.id}>
                            <Image
                              src={downloadUrl}
                              alt={att.filename}
                              maw={240}
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
                          key={att.id}
                          href={downloadUrl}
                          download
                          size="xs"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <IconFile size={14} />
                          {att.filename} ({formatFileSize(att.fileSize)})
                        </Anchor>
                      );
                    })}
                  </Stack>
                )}
              </Paper>
              {showNewMailDivider && (
                <Divider
                  my="xs"
                  label="New mail above"
                  labelPosition="center"
                  color="blue"
                />
              )}
            </React.Fragment>
          );
        })}
      </Stack>
      </Container>
    </ScrollArea>
  );
};
