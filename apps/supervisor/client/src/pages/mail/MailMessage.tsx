import { ActionIcon, Card, Flex, Group, Stack, Text } from "@mantine/core";
import { IconCornerUpLeft, IconMailbox, IconSend } from "@tabler/icons-react";
import React, { useState } from "react";
import { useSession } from "../../contexts/SessionContext";
import { MailMessage as MailMessageType } from "../../lib/apiClient";

interface MailMessageProps {
  message: MailMessageType;
  currentAgent?: string;
  agents: { name: string; title?: string }[];
  onReply?: (recipientId: number, subject: string, body: string) => void;
}

export const MailMessage: React.FC<MailMessageProps> = ({
  message,
  currentAgent,
  agents,
  onReply,
}) => {
  const { isAuthenticated } = useSession();
  const [isExpanded, setIsExpanded] = useState(false);
  const isFromCurrentAgent =
    currentAgent && message.fromUsername === currentAgent;
  const recipientUsernames = message.recipients.map((r) => r.username);

  const messageWithSubject = `${message.subject} - ${message.body}`;
  const hasMoreContent =
    messageWithSubject.includes("\n") || messageWithSubject.length > 100;

  const fromToUsernames = isFromCurrentAgent
    ? recipientUsernames.length > 0
      ? recipientUsernames
      : ["Unknown"]
    : [message.fromUsername];

  return (
    <Card
      padding="md"
      radius="md"
      withBorder
      style={{
        marginBottom: "8px",
        cursor: hasMoreContent ? "pointer" : "default",
      }}
      onClick={() => hasMoreContent && setIsExpanded(!isExpanded)}
    >
      <Stack gap="sm">
        <Flex justify="space-between" align="center">
          <Flex align="center" gap="sm" style={{ minWidth: 0 }}>
            <ActionIcon
              variant="light"
              color={isFromCurrentAgent ? "blue" : "green"}
              size="sm"
              title={isFromCurrentAgent ? "Sent" : "Received"}
            >
              {isFromCurrentAgent ? (
                <IconSend size={16} />
              ) : (
                <IconMailbox size={16} />
              )}
            </ActionIcon>
            <Group
              gap="xs"
              align="baseline"
              style={{ minWidth: "80px", flexShrink: 0 }}
            >
              <Text size="xs" c="dimmed" fw={400} style={{ flexShrink: 0 }}>
                {isFromCurrentAgent ? "Sent To:" : "Received From:"}
              </Text>
              <Group gap="xs" align="baseline" style={{ flexWrap: "wrap" }}>
                {fromToUsernames.map((username, index) => {
                  const agent = agents.find((a) => a.name === username);
                  return (
                    <React.Fragment key={username}>
                      {index > 0 && (
                        <Text size="sm" c="dimmed">
                          ,
                        </Text>
                      )}
                      <Text size="sm" fw={600}>
                        {username}
                      </Text>
                      {agent?.title && (
                        <Text size="xs" c="dimmed" fw={400}>
                          ({agent.title})
                        </Text>
                      )}
                    </React.Fragment>
                  );
                })}
              </Group>
              {!isFromCurrentAgent && onReply && (
                <ActionIcon
                  variant="subtle"
                  color="blue"
                  size="sm"
                  disabled={!isAuthenticated}
                  onClick={(e) => {
                    e.stopPropagation();
                    const quotedBody = message.body
                      .split("\n")
                      .map((line) => `> ${line}`)
                      .join("\n");
                    onReply(
                      message.fromUserId,
                      `RE: ${message.subject}`,
                      `\n\n${quotedBody}`,
                    );
                  }}
                  title="Reply"
                >
                  <IconCornerUpLeft size={14} />
                </ActionIcon>
              )}
            </Group>
          </Flex>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            {new Date(message.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            {new Date(message.createdAt).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </Text>
        </Flex>
        <Text
          style={{
            whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
            wordBreak: "break-word",
            overflow: isExpanded ? "visible" : "hidden",
            textOverflow: isExpanded ? "clip" : "ellipsis",
          }}
        >
          <Text component="span" fw={600}>
            {message.subject}
          </Text>{" "}
          -{" "}
          <Text component="span" c={"dimmed"} size="sm">
            {isExpanded ? message.body : message.body.split("\n")[0]}
            {message.body.split("\n").length > 1 && !isExpanded && "🔽"}
          </Text>
        </Text>
      </Stack>
    </Card>
  );
};
