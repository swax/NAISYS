import {
  ActionIcon,
  Anchor,
  Card,
  Flex,
  Group,
  Image,
  Stack,
  Text,
} from "@mantine/core";
import { formatFileSize } from "@naisys/common";
import {
  IconChecks,
  IconCornerUpLeft,
  IconFile,
  IconMailbox,
  IconPaperclip,
  IconSend,
} from "@tabler/icons-react";
import React, { useState } from "react";

import {
  API_BASE,
  apiEndpoints,
  MailMessage as MailMessageType,
} from "../../lib/apiClient";

function isImageFilename(filename: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(filename);
}

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
  const [isExpanded, setIsExpanded] = useState(false);
  const isFromCurrentAgent =
    currentAgent && message.fromUsername === currentAgent;
  const recipientUsernames = message.recipients.map((r) => r.username);

  const messageWithSubject = `${message.subject} - ${message.body}`;
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const hasMoreContent =
    messageWithSubject.includes("\n") ||
    messageWithSubject.length > 100 ||
    hasAttachments;

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
                  const recipient = isFromCurrentAgent
                    ? message.recipients.find((r) => r.username === username)
                    : undefined;
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
                      {recipient?.readAt && (
                        <IconChecks
                          size={14}
                          color="var(--mantine-color-blue-filled)"
                          title={`Read ${new Date(recipient.readAt).toLocaleString()}`}
                        />
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
          {hasAttachments && (
            <IconPaperclip
              size={14}
              stroke={1.5}
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                marginRight: 4,
                color: "var(--mantine-color-dimmed)",
              }}
            />
          )}
          <Text component="span" fw={600}>
            {message.subject}
          </Text>{" "}
          -{" "}
          <Text component="span" c={"dimmed"} size="sm">
            {isExpanded ? message.body : message.body.split("\n")[0]}
            {message.body.split("\n").length > 1 && !isExpanded && "🔽"}
          </Text>
        </Text>
        {isExpanded && hasAttachments && (
          <Stack gap="xs" mt="xs">
            <Text size="xs" fw={600} c="dimmed">
              Attachments:
            </Text>
            {message.attachments!.map((att) => {
              const downloadUrl = `${API_BASE}${apiEndpoints.attachmentDownload(att.id)}`;
              return (
                <Group key={att.id} gap="xs" align="center">
                  {isImageFilename(att.filename) ? (
                    <Image
                      src={downloadUrl}
                      alt={att.filename}
                      h={60}
                      w="auto"
                      fit="contain"
                      radius="sm"
                      style={{ cursor: "pointer" }}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        window.open(downloadUrl, "_blank");
                      }}
                    />
                  ) : (
                    <IconFile size={16} />
                  )}
                  <Anchor
                    href={downloadUrl}
                    download
                    size="xs"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    {att.filename}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    ({formatFileSize(att.fileSize)})
                  </Text>
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Card>
  );
};
