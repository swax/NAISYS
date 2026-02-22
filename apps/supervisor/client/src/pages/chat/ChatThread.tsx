import { Box, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import React, { useEffect, useRef } from "react";
import type { ChatMessage } from "../../lib/apiClient";

interface ChatThreadProps {
  messages: ChatMessage[];
  currentAgentId: number;
}

export const ChatThread: React.FC<ChatThreadProps> = ({
  messages,
  currentAgentId,
}) => {
  const viewport = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessageCount.current && viewport.current) {
      viewport.current.scrollTo({
        top: viewport.current.scrollHeight,
        behavior: messages.length - prevMessageCount.current > 5 ? "instant" : "smooth",
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

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
      <Stack gap="xs" p="md">
        {messages.map((msg) => {
          const isOwn = msg.fromUserId === currentAgentId;
          const msgDate = formatDate(msg.createdAt);
          const showDateDivider = msgDate !== lastDate;
          lastDate = msgDate;

          return (
            <React.Fragment key={msg.id}>
              {showDateDivider && (
                <Text
                  size="xs"
                  c="dimmed"
                  ta="center"
                  py="xs"
                >
                  {msgDate}
                </Text>
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
                      {msg.fromUsername}
                    </Text>
                  )}
                  <Text
                    size="sm"
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      color: isOwn ? "white" : undefined,
                    }}
                  >
                    {msg.body}
                  </Text>
                  <Text
                    size="xs"
                    c={isOwn ? "rgba(255,255,255,0.7)" : "dimmed"}
                    ta="right"
                    mt={2}
                  >
                    {formatTime(msg.createdAt)}
                  </Text>
                </Paper>
              </Box>
            </React.Fragment>
          );
        })}
      </Stack>
    </ScrollArea>
  );
};
