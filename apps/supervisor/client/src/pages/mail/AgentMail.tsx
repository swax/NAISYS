import {
  Alert,
  Button,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { hasAction } from "@naisys/common";
import { IconMailbox, IconPlus, IconSend } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useMailData } from "../../hooks/useMailData";
import { MailMessage as MailMessageType } from "../../lib/apiClient";
import { sendMail } from "../../lib/apiMail";
import { MailMessage } from "./MailMessage";
import { NewMessageModal } from "./NewMessageModal";

export const AgentMail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { agents, updateReadStatus, readStatus } = useAgentDataContext();

  const agentId = id ? Number(id) : 0;
  const agent = agents.find((a) => a.id === agentId);
  const agentName = agent?.name || "";

  // Use the new useMailData hook
  const {
    mail: allMail,
    total: totalMail,
    actions: mailActions,
    isLoading: mailLoading,
    error: mailError,
  } = useMailData(agentId, Boolean(id));

  const canSend = hasAction(mailActions, "send");

  console.log(`Loaded mail for agent ${agentName}`);

  // Save the initial lastReadMailId to determine where to show the divider
  const [lastReadMailId] = useState<number | null>(
    agentName && readStatus[agentName]
      ? readStatus[agentName].lastReadMailId
      : null,
  );

  // Update read status when viewing mail
  useEffect(() => {
    const maxMailId = allMail.reduce(
      (max, mail) => (mail.id > max ? mail.id : max),
      0,
    );
    void updateReadStatus(agentName, undefined, maxMailId);
  }, [allMail]);

  const [showSent, setShowSent] = useState(false);
  const [showReceived, setShowReceived] = useState(false);
  const [newMessageModalOpened, setNewMessageModalOpened] = useState(false);
  const [sendStatus, setSendStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [replyData, setReplyData] = useState<{
    recipientId: number;
    subject: string;
    body: string;
  } | null>(null);

  // Filter mail based on sent/received status and sort by newest first
  const getFilteredMail = (): MailMessageType[] => {
    // If neither button is selected, show all messages
    if (!showSent && !showReceived) {
      return allMail.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }

    return allMail
      .filter((mail) => {
        const messageFromCurrentAgent = mail.fromUsername === agentName;

        if (showSent && showReceived) return true;
        if (showSent && messageFromCurrentAgent) return true;
        if (showReceived && !messageFromCurrentAgent) return true;

        return false;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  };

  const filteredMail = getFilteredMail();

  // Calculate sent and received counts
  const sentCount = allMail.filter((mail) => {
    return mail.fromUsername === agentName;
  }).length;

  const receivedCount = allMail.filter((mail) => {
    return mail.fromUsername !== agentName;
  }).length;

  // Handle reply to a message
  const handleReply = (recipientId: number, subject: string, body: string) => {
    setReplyData({ recipientId, subject, body });
    setNewMessageModalOpened(true);
  };

  // Handle sending a new message
  const handleSendMessage = async (
    recipientId: number,
    subject: string,
    body: string,
    attachments: Array<{ file: File; name: string; previewUrl?: string }>,
  ): Promise<void> => {
    try {
      const response = await sendMail(agentId, {
        fromId: agentId,
        toId: recipientId,
        subject,
        message: body,
        files: attachments.map((attachment) => attachment.file),
      });

      if (response.success) {
        setSendStatus({
          type: "success",
          message: "Message sent successfully!",
        });
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

  if (!id) {
    return (
      <Stack gap="md" style={{ height: "100%" }}>
        <Group justify="space-between">
          <Text size="xl" fw={600}>
            Mail Overview
          </Text>
        </Group>

        <Stack gap="lg" align="center">
          <Text c="dimmed" ta="center">
            Select an agent from the sidebar to view their mail
          </Text>
        </Stack>
      </Stack>
    );
  }

  if (!agent) {
    return (
      <Alert color="yellow" title="Agent not found">
        Agent with ID {id} not found
      </Alert>
    );
  }

  return (
    <Stack gap="md" style={{ height: "100%" }}>
      <Group justify="space-between">
        {canSend && (
          <Button
            variant="outline"
            size="xs"
            leftSection={<IconPlus size={16} />}
            onClick={() => setNewMessageModalOpened(true)}
          >
            New Message
          </Button>
        )}
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
          {String(mailError)}
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
        {filteredMail.map((message, index) => {
          return (
            <React.Fragment key={message.id}>
              {message.id == lastReadMailId && index != 0 && (
                <Divider
                  my="md"
                  label={"New mail above"}
                  labelPosition="center"
                  color="blue"
                />
              )}
              <MailMessage
                message={message}
                currentAgent={agentName}
                agents={agents}
                onReply={canSend ? handleReply : undefined}
              />
            </React.Fragment>
          );
        })}
        {filteredMail.length === 0 && !mailLoading && (
          <Text c="dimmed" ta="center">
            No mail messages available for {agent.name}
          </Text>
        )}
        {totalMail > 0 && (
          <Text c="dimmed" ta="center" size="sm" mt="md">
            Showing {Math.min(50, totalMail)} / {totalMail} messages
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
        currentAgentId={agentId}
        onSend={handleSendMessage}
        initialRecipientId={replyData?.recipientId}
        initialSubject={replyData?.subject}
        initialBody={replyData?.body}
      />
    </Stack>
  );
};
