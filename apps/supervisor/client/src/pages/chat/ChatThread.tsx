import {
  Anchor,
  Box,
  Button,
  Container,
  Image,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { formatFileSize, isImageFilename } from "@naisys/common";
import { CompactMarkdown } from "@naisys/common-browser";
import { IconCheck, IconChecks, IconFile } from "@tabler/icons-react";
import React, { useEffect, useMemo, useRef } from "react";

import { RunDividerLine } from "../../components/RunDividerLine";
import { useThreadRuns } from "../../hooks/useThreadRuns";
import type { ChatMessage } from "../../lib/apiClient";
import { buildThreadDividers } from "../../lib/threadRunDividers";

interface ChatThreadProps {
  messages: ChatMessage[];
  currentAgentId: number;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  participants: string[];
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  messages,
  currentAgentId,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  participants,
}) => {
  const viewport = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessageCount.current && viewport.current) {
      viewport.current.scrollTo({
        top: viewport.current.scrollHeight,
        behavior:
          messages.length - prevMessageCount.current > 5 ? "instant" : "smooth",
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  const oldestMessageTime = useMemo(() => {
    if (messages.length === 0) return null;
    let oldest = messages[0].createdAt;
    for (const m of messages) {
      if (new Date(m.createdAt).getTime() < new Date(oldest).getTime()) {
        oldest = m.createdAt;
      }
    }
    return oldest;
  }, [messages]);

  const { runs } = useThreadRuns(participants, oldestMessageTime);

  const { beforeMessage: runDividers, trailing: trailingDivider } = useMemo(
    () => buildThreadDividers(messages, runs),
    [messages, runs],
  );

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
        <Text c="dimmed">No messages yet. Start the conversation!</Text>
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

  // Group messages by date
  let lastDate = "";

  return (
    <ScrollArea style={{ flex: 1 }} viewportRef={viewport}>
      <Container size="md" w="100%" p="md">
        <Stack gap="xs">
          {hasMore && (
            <Stack gap={4} align="center" py="xs">
              <Text c="dimmed" size="xs">
                Showing {messages.length} / {total} messages
              </Text>
              <Button
                variant="subtle"
                size="compact-xs"
                loading={loadingMore}
                onClick={onLoadMore}
              >
                Load Older Messages
              </Button>
            </Stack>
          )}
          {messages.map((msg) => {
            const isOwn = msg.fromUserId === currentAgentId;
            const msgDate = formatDate(msg.createdAt);
            const showDateDivider = msgDate !== lastDate;
            lastDate = msgDate;

            return (
              <React.Fragment key={msg.id}>
                {showDateDivider && (
                  <Text size="xs" c="dimmed" ta="center" py="xs">
                    {msgDate}
                  </Text>
                )}
                {runDividers.get(msg.id) && (
                  <RunDividerLine divider={runDividers.get(msg.id)!} />
                )}
                <Box
                  style={{
                    display: "flex",
                    justifyContent: isOwn ? "flex-end" : "flex-start",
                  }}
                >
                  <Paper
                    p="xs"
                    px="sm"
                    radius="lg"
                    style={{
                      maxWidth: "75%",
                      backgroundColor: isOwn
                        ? "var(--mantine-color-blue-filled)"
                        : "var(--mantine-color-dark-5)",
                    }}
                  >
                    {!isOwn && (
                      <Text size="xs" fw={600} c="dimmed" mb={2}>
                        {msg.fromUsername} ({msg.fromTitle})
                      </Text>
                    )}
                    <Text
                      size="sm"
                      style={{
                        wordBreak: "break-word",
                        color: isOwn ? "white" : undefined,
                      }}
                    >
                      <CompactMarkdown>{msg.body}</CompactMarkdown>
                    </Text>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <Stack gap={4} mt="xs">
                        {msg.attachments.map((att) => {
                          const downloadUrl = att.downloadUrl;
                          if (isImageFilename(att.filename)) {
                            return (
                              <Box key={att.id}>
                                <Image
                                  src={downloadUrl}
                                  alt={att.filename}
                                  maw={240}
                                  radius="sm"
                                  style={{ cursor: "pointer" }}
                                  onClick={() =>
                                    window.open(downloadUrl, "_blank")
                                  }
                                />
                                <Text
                                  size="xs"
                                  c={isOwn ? "rgba(255,255,255,0.7)" : "dimmed"}
                                  mt={2}
                                >
                                  {att.filename} ({formatFileSize(att.fileSize)}
                                  )
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
                              c={isOwn ? "white" : undefined}
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
                    <Text
                      size="xs"
                      c={isOwn ? "rgba(255,255,255,0.7)" : "dimmed"}
                      ta="right"
                      mt={2}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 4,
                      }}
                    >
                      {formatTime(msg.createdAt)}
                      {isOwn &&
                        (msg.readBy && msg.readBy.length > 0 ? (
                          <IconChecks
                            size={14}
                            color="rgba(255,255,255,0.7)"
                            title="Read"
                          />
                        ) : (
                          <IconCheck
                            size={14}
                            color="rgba(255,255,255,0.7)"
                            title="Delivered"
                          />
                        ))}
                    </Text>
                  </Paper>
                </Box>
              </React.Fragment>
            );
          })}
          {trailingDivider && <RunDividerLine divider={trailingDivider} />}
        </Stack>
      </Container>
    </ScrollArea>
  );
};
