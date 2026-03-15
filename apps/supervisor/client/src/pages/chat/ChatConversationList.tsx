import { Button, Group, NavLink, ScrollArea, Stack, Text } from "@mantine/core";
import { IconMessagePlus } from "@tabler/icons-react";
import React, { useState } from "react";
import { Link } from "react-router-dom";

import type { Agent, ChatConversation } from "../../lib/apiClient";
import { NewChatDialog } from "./NewChatDialog";

interface ChatConversationListProps {
  conversations: ChatConversation[];
  activeParticipants: string | null;
  onNavLinkClick?: () => void;
  onNewChat: (toIds: number[]) => void;
  canSend: boolean;
  agents: Agent[];
  currentAgentId: number;
  agentName: string;
}

export const ChatConversationList: React.FC<ChatConversationListProps> = ({
  conversations,
  activeParticipants,
  onNavLinkClick,
  onNewChat,
  canSend,
  agents,
  currentAgentId,
  agentName,
}) => {
  const [newChatOpened, setNewChatOpened] = useState(false);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  return (
    <Stack gap={0} style={{ height: "100%" }}>
      {canSend && (
        <Group
          p="xs"
          style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
        >
          <Button
            variant="light"
            size="xs"
            leftSection={<IconMessagePlus size={16} />}
            onClick={() => setNewChatOpened(true)}
            fullWidth
          >
            New Chat
          </Button>
        </Group>
      )}

      <ScrollArea style={{ flex: 1 }}>
        {conversations.length === 0 ? (
          <Text c="dimmed" ta="center" size="sm" p="md">
            No conversations yet
          </Text>
        ) : (
          conversations.map((conv) => {
            const otherParticipants = conv.participants
              .split(",")
              .filter((n) => n !== agentName)
              .join(",");

            return (
              <NavLink
                key={conv.participants}
                active={activeParticipants === conv.participants}
                component={Link}
                to={`/agents/${agentName}/chat/${otherParticipants}`}
                onClick={onNavLinkClick}
                label={
                  conv.participantNames.length === 1
                    ? `${conv.participantNames[0]} (${conv.participantTitles[0]})`
                    : conv.participantNames.join(", ")
                }
                description={
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {conv.lastMessageFrom}: {conv.lastMessage}
                  </Text>
                }
                rightSection={
                  <Text size="xs" c="dimmed">
                    {formatTime(conv.lastMessageAt)}
                  </Text>
                }
                styles={{
                  root: {
                    borderBottom: "1px solid var(--mantine-color-dark-6)",
                  },
                }}
              />
            );
          })
        )}
      </ScrollArea>

      <NewChatDialog
        opened={newChatOpened}
        onClose={() => setNewChatOpened(false)}
        onNewChat={(toIds) => {
          onNewChat(toIds);
          setNewChatOpened(false);
        }}
        agents={agents}
        currentAgentId={currentAgentId}
      />
    </Stack>
  );
};
