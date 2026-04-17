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
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { ParticipantInfo } from "../../components/ParticipantInfo";
import { SIDEBAR_WIDTH } from "../../constants";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useMailData } from "../../hooks/useMailData";
import { archiveAllMail, sendMail } from "../../lib/apiMail";
import { MailConversationList } from "./MailConversationList";
import {
  getConversationMessages,
  groupIntoConversations,
  normalizeSubject,
} from "./mailConversations";
import { MailThread } from "./MailThread";
import { NewMessageModal } from "./NewMessageModal";

export const AgentMail: React.FC = () => {
  const { username, "*": splatParam } = useParams<{
    username: string;
    "*": string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
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
    loadMore,
    loadingMore,
    hasMore,
    refresh: refreshMail,
  } = useMailData(username ?? "", Boolean(username));

  const canSend = !!hasAction(mailActions, "send");
  const canArchive = !!hasAction(mailActions, "archive");

  const handleArchiveAll = useCallback(async () => {
    await archiveAllMail(username ?? "");
    await refreshMail();
  }, [username, refreshMail]);

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

  // Determine URL mode
  const basePath = `/agents/${username}/mail`;
  const urlPath = location.pathname;
  const isAboutUrl = urlPath.startsWith(`${basePath}/about/`);
  const isWithUrl = urlPath.startsWith(`${basePath}/with/`);
  const hasSelection = isAboutUrl || isWithUrl;

  // groupBySubject state: synced from URL when a selection exists,
  // preserved across toggles when at base /mail
  const [groupBySubject, setGroupBySubject] = useState(isAboutUrl);

  // Sync groupBySubject from URL when navigating to a specific conversation
  useEffect(() => {
    if (isAboutUrl) setGroupBySubject(true);
    else if (isWithUrl) setGroupBySubject(false);
  }, [isAboutUrl, isWithUrl]);

  // Modal state
  const [newMessageModalOpened, setNewMessageModalOpened] = useState(false);
  const [replyData, setReplyData] = useState<{
    recipientId: number;
    subject: string;
    body: string;
  } | null>(null);

  // Group into conversations
  const conversations = useMemo(
    () =>
      groupIntoConversations(
        allMail,
        lastReadMailId,
        groupBySubject,
        agentName,
      ),
    [allMail, lastReadMailId, groupBySubject, agentName],
  );

  // Derive selectedKey from URL
  const selectedKey = useMemo(() => {
    if (isAboutUrl && splatParam) {
      return decodeURIComponent(splatParam);
    }
    if (isWithUrl && splatParam) {
      const others = splatParam.split(",").filter(Boolean);
      return [...others, agentName].sort().join(",");
    }
    return null;
  }, [isAboutUrl, isWithUrl, splatParam, agentName]);

  // Auto-select first conversation when no selection in URL and conversations exist
  useEffect(() => {
    if (!hasSelection && conversations.length > 0 && username) {
      const first = conversations[0];
      if (groupBySubject) {
        void navigate(
          `${basePath}/about/${encodeURIComponent(first.normalizedSubject)}`,
          { replace: true },
        );
      } else {
        const others = first.participantNames
          .filter((n) => n !== agentName)
          .sort()
          .join(",");
        void navigate(`${basePath}/with/${others}`, { replace: true });
      }
    }
  }, [
    conversations,
    hasSelection,
    username,
    agentName,
    groupBySubject,
    basePath,
    navigate,
  ]);

  // Get thread messages for selected conversation
  const threadMessages = useMemo(() => {
    if (!selectedKey) return [];
    return getConversationMessages(allMail, selectedKey, groupBySubject);
  }, [allMail, selectedKey, groupBySubject]);

  // Get the selected conversation object for display
  const selectedConversation = conversations.find((c) => c.key === selectedKey);

  const handleToggleGroupBySubject = useCallback(() => {
    setGroupBySubject((v) => !v);
    // Navigate to base mail URL; auto-select will pick the first conversation in new mode
    void navigate(basePath, { replace: true });
  }, [basePath, navigate]);

  const handleReply = useCallback(() => {
    if (!threadMessages.length) return;
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
    recipientIds: number[],
    subject: string,
    body: string,
    attachments: Array<{ file: File; name: string; previewUrl?: string }>,
  ): Promise<void> => {
    const response = await sendMail(username ?? "", {
      fromId: agentId,
      toIds: recipientIds,
      subject,
      message: body,
      files: attachments.map((attachment) => attachment.file),
    });

    if (!response.success) {
      throw new Error(response.message || "Failed to send message");
    }
  };

  const otherParticipantNames = useMemo(
    () =>
      selectedConversation
        ? selectedConversation.participantNames.filter((n) => n !== agentName)
        : [],
    [selectedConversation, agentName],
  );

  const handleSwitchPerspective = useCallback(
    (name: string) => {
      if (!agentName) return;
      if (groupBySubject && selectedConversation?.normalizedSubject) {
        void navigate(
          `/agents/${name}/mail/about/${encodeURIComponent(
            selectedConversation.normalizedSubject,
          )}`,
        );
        return;
      }
      const newOthers = otherParticipantNames
        .filter((n) => n !== name)
        .concat(agentName)
        .sort();
      void navigate(`/agents/${name}/mail/with/${newOthers.join(",")}`);
    },
    [
      agentName,
      groupBySubject,
      selectedConversation,
      otherParticipantNames,
      navigate,
    ],
  );

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
      activeKey={selectedKey}
      onNavLinkClick={closeDrawer}
      onNewMessage={() => setNewMessageModalOpened(true)}
      canSend={canSend}
      groupBySubject={groupBySubject}
      onToggleGroupBySubject={handleToggleGroupBySubject}
      currentAgentName={agentName}
      agentName={username}
      agents={agents}
      totalMessages={totalMail}
      loadedMessages={allMail.length}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
      canArchive={canArchive}
      onArchiveAll={handleArchiveAll}
    />
  );

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
              {/* Mobile conversation toggle */}
              <UnstyledButton
                hiddenFrom="sm"
                onClick={openDrawer}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                <ActionIcon variant="subtle" color="gray" component="span">
                  <IconMail size="1.2rem" />
                </ActionIcon>
              </UnstyledButton>
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                {groupBySubject && selectedConversation?.normalizedSubject && (
                  <Text size="sm" fw={600} truncate>
                    {selectedConversation.normalizedSubject}
                  </Text>
                )}
                <ParticipantInfo
                  names={otherParticipantNames}
                  agents={agents}
                  onSwitch={handleSwitchPerspective}
                />
              </Stack>
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
        initialBody={replyData?.body}
      />
    </Box>
  );
};
