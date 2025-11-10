import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Flex,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconCornerUpLeft,
  IconMailbox,
  IconPlus,
  IconSend,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { NewMessageModal } from "../components/NewMessageModal";
import { useNaisysDataContext } from "../contexts/NaisysDataContext";
import { ThreadMessage, sendMail } from "../lib/apiClient";

const MailMessageComponent: React.FC<{
  message: ThreadMessage;
  currentAgent?: string;
  agents: any[];
  onReply?: (recipient: string, subject: string, body: string) => void;
}> = ({ message, currentAgent, agents, onReply }) => {
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
                {isFromCurrentAgent ? "To:" : "From:"}
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
          <Text component="span" c={isExpanded ? undefined : "dimmed"}>
            {message.message}
          </Text>
        </Text>
      </Stack>
    </Card>
  );
};

export const Mail: React.FC = () => {
  const { agent: agentParam } = useParams<{ agent: string }>();
  const {
    agents,
    getMailForAgent,
    isLoading: mailLoading,
    error: mailError,
    readStatus,
    updateReadStatus,
  } = useNaisysDataContext();

  const [showSent, setShowSent] = useState(false);
  const [showReceived, setShowReceived] = useState(false);
  const [newMessageModalOpened, setNewMessageModalOpened] = useState(false);
  const [sendStatus, setSendStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [replyData, setReplyData] = useState<{
    recipient: string;
    subject: string;
    body: string;
  } | null>(null);
  // Get filtered mail for the current agent
  const allMail = getMailForAgent(agentParam);

  // Filter mail based on sent/received status and sort by newest first
  const getFilteredMail = (): ThreadMessage[] => {
    // If neither button is selected, show all messages
    if (!showSent && !showReceived) {
      return allMail.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
    }

    return allMail
      .filter((mail) => {
        const messageFromCurrentAgent = mail.username === agentParam;

        if (showSent && showReceived) return true;
        if (showSent && messageFromCurrentAgent) return true;
        if (showReceived && !messageFromCurrentAgent) return true;

        return false;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const filteredMail = getFilteredMail();

  // Update read status when viewing mail - only when latest mail ID changes
  useEffect(() => {
    if (!agentParam || !readStatus[agentParam]) return;

    // Get read status for the current agent
    const userReadStatus = readStatus[agentParam];

    const latestMailId = userReadStatus.latestMailId;
    if (
      !userReadStatus.lastReadMailId ||
      latestMailId > userReadStatus.lastReadMailId
    ) {
      updateReadStatus(agentParam, undefined, latestMailId);
    }
  }, [allMail, readStatus, updateReadStatus]);

  // Calculate sent and received counts
  const sentCount = allMail.filter((mail) => {
    return mail.username === agentParam;
  }).length;

  const receivedCount = allMail.filter((mail) => {
    return mail.username !== agentParam;
  }).length;

  // Handle reply to a message
  const handleReply = (recipient: string, subject: string, body: string) => {
    setReplyData({ recipient, subject, body });
    setNewMessageModalOpened(true);
  };

  // Handle sending a new message
  const handleSendMessage = async (
    sender: string,
    recipient: string,
    subject: string,
    body: string,
    attachments: Array<{ file: File; name: string; previewUrl?: string }>,
  ): Promise<void> => {
    try {
      const response = await sendMail({
        from: sender,
        to: recipient,
        subject,
        message: body,
        files: attachments.map((attachment) => attachment.file),
      });

      if (response.success) {
        setSendStatus({
          type: "success",
          message: "Message sent successfully!",
        });
        // TODO: Optionally refresh data to show the sent message
      } else {
        setSendStatus({
          type: "error",
          message: response.message || "Failed to send message",
        });
      }
    } catch (error) {
      setSendStatus({
        type: "error",
        message:
          error instanceof Error ? error.message : "Error sending message",
      });
    }
  };

  if (mailLoading) {
    return <Loader size="lg" />;
  }

  if (!agentParam) {
    return (
      <Stack gap="md" style={{ height: "100%" }}>
        <Group justify="space-between">
          <Text size="xl" fw={600}>
            Mail Overview
          </Text>
        </Group>

        {mailError && (
          <Alert color="red" title="Error loading mail">
            {mailError instanceof Error
              ? mailError.message
              : "Failed to load mail"}
          </Alert>
        )}

        {mailLoading ? (
          <Group justify="center">
            <Loader size="md" />
            <Text>Loading mail...</Text>
          </Group>
        ) : (
          <Stack gap="lg" align="center">
            <Card padding="xl" radius="md" withBorder>
              <Stack gap="sm" align="center">
                <Text size="xl" fw={700} c="blue">
                  {allMail.length}
                </Text>
                <Text size="lg" c="dimmed">
                  Total Messages
                </Text>
              </Stack>
            </Card>
            <Text c="dimmed" ta="center">
              Select an agent from the sidebar to view their mail
            </Text>
          </Stack>
        )}
      </Stack>
    );
  }

  const agent = agents.find((a) => a.name === agentParam);

  if (!agent) {
    return (
      <Alert color="yellow" title="Agent not found">
        Agent "{agentParam}" not found
      </Alert>
    );
  }

  return (
    <Stack gap="md" style={{ height: "100%" }}>
      <Group justify="space-between">
        <Button
          variant="outline"
          size="xs"
          leftSection={<IconPlus size={16} />}
          onClick={() => setNewMessageModalOpened(true)}
        >
          New Message
        </Button>
        <Group gap="md">
          <Button
            variant={showReceived ? "filled" : "outline"}
            size="xs"
            onClick={() => setShowReceived(!showReceived)}
            leftSection={<IconMailbox size={14} />}
          >
            Received ({receivedCount})
          </Button>
          <Button
            variant={showSent ? "filled" : "outline"}
            size="xs"
            onClick={() => setShowSent(!showSent)}
            leftSection={<IconSend size={14} />}
          >
            Sent ({sentCount})
          </Button>
        </Group>
      </Group>

      {mailError && (
        <Alert color="red" title="Error loading mail">
          {mailError instanceof Error
            ? mailError.message
            : "Failed to load mail"}
        </Alert>
      )}

      {sendStatus && (
        <Alert
          color={sendStatus.type === "success" ? "green" : "red"}
          title={sendStatus.type === "success" ? "Success" : "Error"}
          onClose={() => setSendStatus(null)}
          withCloseButton
        >
          {sendStatus.message}
        </Alert>
      )}

      {mailLoading && allMail.length === 0 && (
        <Group justify="center">
          <Loader size="md" />
          <Text>Loading mail...</Text>
        </Group>
      )}

      <Stack gap="xs">
        {filteredMail.map((message) => (
          <MailMessageComponent
            key={message.id}
            message={message}
            currentAgent={agentParam}
            agents={agents}
            onReply={handleReply}
          />
        ))}
        {filteredMail.length === 0 && !mailLoading && (
          <Text c="dimmed" ta="center">
            No mail messages available for {agent.name}
          </Text>
        )}
      </Stack>

      <NewMessageModal
        opened={newMessageModalOpened}
        onClose={() => {
          setNewMessageModalOpened(false);
          setReplyData(null);
        }}
        agents={agents}
        currentAgentName={agentParam}
        onSend={handleSendMessage}
        initialRecipient={replyData?.recipient}
        initialSubject={replyData?.subject}
        initialBody={replyData?.body}
      />
    </Stack>
  );
};
