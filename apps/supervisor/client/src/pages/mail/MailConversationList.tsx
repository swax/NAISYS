import {
  Button,
  Checkbox,
  Group,
  Indicator,
  NavLink,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import React from "react";

import type { MailConversation } from "./mailConversations";

interface MailConversationListProps {
  conversations: MailConversation[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onNewMessage: () => void;
  canSend: boolean;
  groupBySubject: boolean;
  onToggleGroupBySubject: () => void;
  currentAgentName: string;
}

export const MailConversationList: React.FC<MailConversationListProps> = ({
  conversations,
  selectedKey,
  onSelect,
  onNewMessage,
  canSend,
  groupBySubject,
  onToggleGroupBySubject,
  currentAgentName,
}) => {
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
            leftSection={<IconPlus size={16} />}
            onClick={onNewMessage}
            fullWidth
          >
            New Message
          </Button>
        </Group>
      )}

      <Group
        p="xs"
        style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
      >
        <Checkbox
          label="Group by subject"
          size="xs"
          checked={groupBySubject}
          onChange={onToggleGroupBySubject}
        />
      </Group>

      <ScrollArea style={{ flex: 1 }}>
        {conversations.length === 0 ? (
          <Text c="dimmed" ta="center" size="sm" p="md">
            No conversations
          </Text>
        ) : (
          conversations.map((conv) => {
            // Show other participants (exclude current agent)
            const otherNames = conv.participantNames.filter(
              (n) => n !== currentAgentName,
            );
            const displayNames =
              otherNames.length > 0
                ? otherNames.join(", ")
                : conv.participantNames.join(", ");

            return (
              <NavLink
                key={conv.key}
                active={selectedKey === conv.key}
                onClick={() => onSelect(conv.key)}
                label={
                  <Group gap={6} wrap="nowrap">
                    {conv.hasUnread && (
                      <Indicator
                        color="blue"
                        size={8}
                        processing
                        style={{ flexShrink: 0 }}
                      >
                        <span />
                      </Indicator>
                    )}
                    <Text
                      size="sm"
                      fw={conv.hasUnread ? 700 : 400}
                      lineClamp={1}
                    >
                      {groupBySubject ? conv.normalizedSubject : displayNames}
                    </Text>
                  </Group>
                }
                description={
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {groupBySubject
                      ? `${displayNames} (${conv.messageCount})`
                      : `${conv.lastMessageFrom}: ${conv.lastMessagePreview}`}
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
    </Stack>
  );
};
