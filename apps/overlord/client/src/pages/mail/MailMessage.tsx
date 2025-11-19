import {
  ActionIcon,
  Card,
  Flex,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconCornerUpLeft,
  IconMailbox,
  IconSend,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { ThreadMessage } from "../../lib/apiClient";

interface MailMessageProps {
  message: ThreadMessage;
  currentAgent?: string;
  agents: any[];
  onReply?: (recipient: string, subject: string, body: string) => void;
}

export const MailMessage: React.FC<MailMessageProps> = ({
  message,
  currentAgent,
  agents,
  onReply,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isFromCurrentAgent = currentAgent && message.username === currentAgent;
  const membersExcludingSender = message.members.filter(
    (member) => member.username !== message.username,
  );

  const messageWithSubject = `${message.subject} - ${message.message}`;
  const hasMoreContent =
    messageWithSubject.includes("\n") || messageWithSubject.length > 100;

  const fromToUsernames = isFromCurrentAgent
    ? membersExcludingSender.map((m) => m.username) || ["Unknown"]
    : [message.username];

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
                  onClick={(e) => {
                    e.stopPropagation();
                    const quotedBody = message.message
                      .split("\n")
                      .map((line) => `> ${line}`)
                      .join("\n");
                    onReply(
                      message.username,
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
            {new Date(message.date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}{" "}
            {new Date(message.date).toLocaleTimeString("en-US", {
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
            {isExpanded ? message.message : message.message.split("\n")[0]}
            {message.message.split("\n").length > 1 && !isExpanded && "🔽"}
          </Text>
        </Text>
      </Stack>
    </Card>
  );
};
