import {
  Alert,
  Button,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import { IconMailbox, IconPlus, IconSend } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useSession } from "../../contexts/SessionContext";
import { useMailData } from "../../hooks/useMailData";
import { MailThreadMessage, sendMail } from "../../lib/apiClient";
import { MailMessage } from "./MailMessage";
import { NewMessageModal } from "./NewMessageModal";

export const Mail: React.FC = () => {
  const { agent: agentParam } = useParams<{ agent: string }>();
  const { agents, updateReadStatus, readStatus } = useAgentDataContext();
  const { isAuthenticated } = useSession();

  // Use the new useMailData hook
  const {
    mail: allMail,
    total: totalMail,
    isLoading: mailLoading,
    error: mailError,
  } = useMailData(agentParam || "", Boolean(agentParam));

  console.log(`Loaded mail for agent ${agentParam}`);

  // Save the initial lastReadMailId to determine where to show the divider
  const [lastReadMailId] = useState<string | null>(
    agentParam && readStatus[agentParam]
      ? readStatus[agentParam].lastReadMailId
      : null,
  );

  // Update read status when viewing mail
  useEffect(() => {
    // Find max ULID using string comparison
    const maxMailId = allMail.reduce(
      (max, mail) => (mail.id > max ? mail.id : max),
      "",
    );
    updateReadStatus(agentParam || "", undefined, maxMailId);
  }, [allMail]);

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

  // Filter mail based on sent/received status and sort by newest first
  const getFilteredMail = (): MailThreadMessage[] => {
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

        <Stack gap="lg" align="center">
          <Text c="dimmed" ta="center">
            Select an agent from the sidebar to view their mail
          </Text>
        </Stack>
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
          disabled={!isAuthenticated}
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
                currentAgent={agentParam}
                agents={agents}
                onReply={handleReply}
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
        currentAgentName={agentParam}
        onSend={handleSendMessage}
        initialRecipient={replyData?.recipient}
        initialSubject={replyData?.subject}
        initialBody={replyData?.body}
      />
    </Stack>
  );
};
