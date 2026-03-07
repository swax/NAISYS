import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { hasAction } from "@naisys/common";
import { IconCornerUpLeft, IconMail } from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { SIDEBAR_WIDTH } from "../../constants";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useMailData } from "../../hooks/useMailData";
import { sendMail } from "../../lib/apiMail";
import { MailConversationList } from "./MailConversationList";
import {
  getConversationMessages,
  groupIntoConversations,
  normalizeSubject,
} from "./mailConversations";
import { MailThread } from "./MailThread";
import { NewMessageModal } from "./NewMessageModal";

export const AgentMail: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const { agents, updateReadStatus, readStatus } = useAgentDataContext();
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();

  const agent = agents.find((a) => a.name === username);
  const agentId = agent?.id ?? 0;
  const agentName = agent?.name || "";

  const {
    mail: allMail,
    total: totalMail,
    actions: mailActions,
    isLoading: mailLoading,
    error: mailError,
  } = useMailData(username ?? "", Boolean(username));

  const canSend = !!hasAction(mailActions, "send");

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

  // Grouping mode
  const [groupBySubject, setGroupBySubject] = useState(true);

  // Selection state
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Modal state
  const [newMessageModalOpened, setNewMessageModalOpened] = useState(false);
  const [replyData, setReplyData] = useState<{
    recipientId: number;
    subject: string;
    body: string;
  } | null>(null);

  // Group into conversations
  const conversations = useMemo(
    () => groupIntoConversations(allMail, lastReadMailId, groupBySubject),
    [allMail, lastReadMailId, groupBySubject],
  );

  // Auto-select first conversation when data loads or selection becomes invalid
  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedKey(null);
      return;
    }
    // If current selection is not in the filtered list, reset to first
    if (
      selectedKey === null ||
      !conversations.some((c) => c.key === selectedKey)
    ) {
      setSelectedKey(conversations[0].key);
    }
  }, [conversations, selectedKey]);

  // Get thread messages for selected conversation (always from allMail for full context)
  const threadMessages = useMemo(() => {
    if (!selectedKey) return [];
    return getConversationMessages(allMail, selectedKey, groupBySubject);
  }, [allMail, selectedKey, groupBySubject]);

  // Get the selected conversation object for display
  const selectedConversation = conversations.find((c) => c.key === selectedKey);

  const handleSelectConversation = useCallback(
    (key: string) => {
      setSelectedKey(key);
      closeDrawer();
    },
    [closeDrawer],
  );

  const handleReply = useCallback(() => {
    if (!threadMessages.length) return;
    // Find the last received message to reply to, or fall back to last message
    const lastReceived = [...threadMessages]
      .reverse()
      .find((m) => m.fromUsername !== agentName);
    const replyTarget =
      lastReceived || threadMessages[threadMessages.length - 1];

    const quotedBody = replyTarget.body
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

    const subject = normalizeSubject(replyTarget.subject);

    setReplyData({
      recipientId: replyTarget.fromUserId,
      subject: `RE: ${subject}`,
      body: `\n\n${quotedBody}`,
    });
    setNewMessageModalOpened(true);
  }, [threadMessages, agentName]);

  const handleSendMessage = async (
    recipientId: number,
    subject: string,
    body: string,
    attachments: Array<{ file: File; name: string; previewUrl?: string }>,
  ): Promise<void> => {
    const response = await sendMail(username ?? "", {
      fromId: agentId,
      toId: recipientId,
      subject,
      message: body,
      files: attachments.map((attachment) => attachment.file),
    });

    if (!response.success) {
      throw new Error(response.message || "Failed to send message");
    }
  };

  if (!username) {
    return (
      <Stack gap="md">
        <Text size="xl" fw={600}>
          Mail
        </Text>
        <Text c="dimmed" ta="center">
          Select an agent from the sidebar to view their mail
        </Text>
      </Stack>
    );
  }

  if (!agent) {
    return (
      <Alert color="yellow" title="Agent not found">
        Agent &quot;{username}&quot; not found
      </Alert>
    );
  }

  if (mailLoading && allMail.length === 0) {
    return <Loader size="lg" />;
  }

  const conversationList = (
    <MailConversationList
      conversations={conversations}
      selectedKey={selectedKey}
      onSelect={handleSelectConversation}
      onNewMessage={() => setNewMessageModalOpened(true)}
      canSend={canSend}
      groupBySubject={groupBySubject}
      onToggleGroupBySubject={() => {
        setGroupBySubject((v) => !v);
        setSelectedKey(null);
      }}
      currentAgentName={agentName}
    />
  );

  const conversationLabel = groupBySubject
    ? selectedConversation?.normalizedSubject
    : selectedConversation?.participantNames
        .filter((n) => n !== agentName)
        .join(", ") ||
      selectedConversation?.participantNames.join(", ");

  return (
    <Box
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Desktop conversation sidebar */}
      <CollapsibleSidebar>{conversationList}</CollapsibleSidebar>

      {/* Mobile drawer for conversations */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title="Mail"
        size={SIDEBAR_WIDTH}
      >
        {conversationList}
      </Drawer>

      {/* Mail thread + reply */}
      <Box
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {mailError && (
          <Alert color="red" title="Error" m="xs">
            {String(mailError)}
          </Alert>
        )}

        {!selectedKey ? (
          <Box
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActionIcon
              hiddenFrom="sm"
              variant="subtle"
              color="gray"
              onClick={openDrawer}
              mb="xs"
            >
              <IconMail size="1.2rem" />
            </ActionIcon>
            <Text c="dimmed">
              {allMail.length === 0
                ? `No mail messages for ${agentName}`
                : "Select a conversation"}
            </Text>
          </Box>
        ) : (
          <>
            {/* Conversation header */}
            <Group
              gap="xs"
              p="xs"
              px="md"
              style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
            >
              {/* Mobile conversation toggle (icon + label) */}
              <UnstyledButton
                hiddenFrom="sm"
                onClick={openDrawer}
                style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}
              >
                <ActionIcon variant="subtle" color="gray" component="span">
                  <IconMail size="1.2rem" />
                </ActionIcon>
                <Text size="sm" fw={600}>
                  {conversationLabel}
                </Text>
              </UnstyledButton>
              {/* Desktop label only */}
              <Text size="sm" fw={600} style={{ flex: 1 }} visibleFrom="sm">
                {conversationLabel}
              </Text>
              {canSend && (
                <Button
                  variant="light"
                  size="compact-xs"
                  leftSection={<IconCornerUpLeft size={14} />}
                  onClick={handleReply}
                >
                  Reply
                </Button>
              )}
            </Group>

            <MailThread
              messages={threadMessages}
              currentAgentName={agentName}
              lastReadMailId={lastReadMailId}
              showSubject={!groupBySubject}
            />

            {totalMail > 0 && (
              <Text c="dimmed" ta="center" size="xs" pb="xs">
                Showing {Math.min(50, totalMail)} / {totalMail} messages
              </Text>
            )}
          </>
        )}
      </Box>

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
      />
    </Box>
  );
};
