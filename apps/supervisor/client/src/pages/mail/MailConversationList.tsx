import {
  Button,
  Checkbox,
  Group,
  NavLink,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { IconArchive, IconPlus } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

import { AgentModelIcon } from "../../components/AgentModelIcon";
import type { Agent } from "../../types/agent";
import type { MailConversation } from "./mailConversations";

interface MailConversationListProps {
  conversations: MailConversation[];
  activeKey: string | null;
  onNavLinkClick?: () => void;
  onNewMessage: () => void;
  canSend: boolean;
  groupBySubject: boolean;
  onToggleGroupBySubject: () => void;
  currentAgentName: string;
  agentName: string;
  agents: Agent[];
  totalMessages: number;
  loadedMessages: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  canArchive: boolean;
  onArchiveAll: () => void;
}

export const MailConversationList: React.FC<MailConversationListProps> = ({
  conversations,
  activeKey,
  onNavLinkClick,
  onNewMessage,
  canSend,
  groupBySubject,
  onToggleGroupBySubject,
  currentAgentName,
  agentName,
  agents,
  totalMessages,
  loadedMessages,
  hasMore,
  loadingMore,
  onLoadMore,
  canArchive,
  onArchiveAll,
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
            const otherIndices = conv.participantNames
              .map((n, i) => (n !== currentAgentName ? i : -1))
              .filter((i) => i >= 0);
            const displayNames =
              otherIndices.length === 1
                ? `${conv.participantNames[otherIndices[0]]} (${conv.participantTitles[otherIndices[0]]})`
                : otherIndices.length > 0
                  ? otherIndices.map((i) => conv.participantNames[i]).join(", ")
                  : conv.participantNames.join(", ");

            // Build link URL based on grouping mode
            const to = groupBySubject
              ? `/agents/${agentName}/mail/about/${encodeURIComponent(conv.normalizedSubject)}`
              : `/agents/${agentName}/mail/with/${conv.participantNames
                  .filter((n) => n !== currentAgentName)
                  .sort()
                  .join(",")}`;
            const iconName =
              conv.participantNames.find((n) => n !== currentAgentName) ??
              conv.participantNames[0];
            const iconAgent = agents.find((a) => a.name === iconName);

            return (
              <NavLink
                key={conv.key}
                active={activeKey === conv.key}
                component={Link}
                to={to}
                onClick={onNavLinkClick}
                label={
                  <Group gap={6} wrap="nowrap">
                    {conv.isArchived && (
                      <IconArchive
                        size={14}
                        style={{ opacity: 0.5, flexShrink: 0 }}
                      />
                    )}
                    <AgentModelIcon
                      shellModel={iconAgent?.shellModel}
                      size={14}
                      style={{
                        flexShrink: 0,
                        opacity: conv.isArchived ? 0.5 : undefined,
                      }}
                    />
                    <Text
                      size="sm"
                      lineClamp={1}
                      style={conv.isArchived ? { opacity: 0.5 } : undefined}
                    >
                      {groupBySubject ? conv.normalizedSubject : displayNames}
                    </Text>
                  </Group>
                }
                description={
                  <Text
                    size="xs"
                    c="dimmed"
                    lineClamp={1}
                    style={conv.isArchived ? { opacity: 0.5 } : undefined}
                  >
                    {groupBySubject
                      ? `${displayNames} (${conv.messageCount})`
                      : `${conv.lastMessageFrom}: ${conv.lastMessagePreview}`}
                  </Text>
                }
                rightSection={
                  <Text
                    size="xs"
                    c="dimmed"
                    style={conv.isArchived ? { opacity: 0.5 } : undefined}
                  >
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

      {totalMessages > 0 && (
        <Stack
          gap={4}
          align="center"
          p="xs"
          style={{ borderTop: "1px solid var(--mantine-color-dark-6)" }}
        >
          {canArchive && (
            <Button
              variant="subtle"
              size="compact-xs"
              color="gray"
              leftSection={<IconArchive size={14} />}
              onClick={() => {
                if (
                  window.confirm(
                    "Archive all mail messages? They will still be visible in supervisor, but hidden from the agent.",
                  )
                ) {
                  onArchiveAll();
                }
              }}
            >
              Archive All
            </Button>
          )}
          <Text c="dimmed" ta="center" size="xs">
            Showing {loadedMessages} / {totalMessages} messages
          </Text>
          {hasMore && (
            <Button
              variant="subtle"
              size="compact-xs"
              loading={loadingMore}
              onClick={onLoadMore}
            >
              Load More
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
};
