import {
  ActionIcon,
  Alert,
  Box,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { formatFileSize, hasAction, MAX_ATTACHMENT_SIZE } from "@naisys/common";
import { IconMessageCircle } from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { ParticipantInfo } from "../../components/ParticipantInfo";
import { SIDEBAR_WIDTH } from "../../constants";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useChatConversations } from "../../hooks/useChatConversations";
import { useChatMessages } from "../../hooks/useChatMessages";
import { buildAgentCandidates } from "../../lib/agentCandidates";
import { archiveAllChat, sendChatMessage } from "../../lib/apiChat";
import { ChatConversationList } from "./ChatConversationList";
import { ChatInput } from "./ChatInput";
import { ChatThread } from "./ChatThread";

export const AgentChat: React.FC = () => {
  const { username, participants: participantsParam } = useParams<{
    username: string;
    participants: string;
  }>();
  const navigate = useNavigate();
  const { agents } = useAgentDataContext();
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();

  const agent = agents.find((a) => a.name === username);
  const agentId = agent?.id ?? 0;

  // Derive selectedParticipants from URL param by adding current agent back
  const selectedParticipants = useMemo(() => {
    if (!participantsParam || !username) return null;
    const others = participantsParam.split(",").filter(Boolean);
    return [...others, username].sort().join(",");
  }, [participantsParam, username]);

  const {
    conversations,
    total: totalConversations,
    actions: convActions,
    isLoading: convLoading,
    error: convError,
    loadMore: loadMoreConversations,
    loadingMore: loadingMoreConversations,
    hasMore: hasMoreConversations,
    refresh: refreshConversations,
  } = useChatConversations(username ?? "", Boolean(username));

  // Build list of agents to show under "Start a chat with", excluding
  // partners we already have a 1:1 conversation with.
  const chatCandidates = useMemo(() => {
    if (!username) return [];
    const existingPartners = new Set<string>();
    for (const conv of conversations) {
      if (conv.participantNames.length === 2) {
        const other = conv.participantNames.find((n) => n !== username);
        if (other) existingPartners.add(other);
      }
    }
    return buildAgentCandidates({
      agents,
      currentAgentName: username,
      excludeNames: existingPartners,
    });
  }, [agents, conversations, username]);

  // Auto-select first conversation when no URL param. If there are no
  // conversations yet, fall back to the first "start a chat with" candidate.
  useEffect(() => {
    if (participantsParam || !username) return;
    if (conversations.length > 0) {
      const first = conversations[0].participants;
      const others = first
        .split(",")
        .filter((n) => n !== username)
        .join(",");
      void navigate(`/agents/${username}/chat/${others}`, { replace: true });
    } else if (!convLoading && chatCandidates.length > 0) {
      void navigate(`/agents/${username}/chat/${chatCandidates[0].name}`, {
        replace: true,
      });
    }
  }, [
    conversations,
    participantsParam,
    username,
    navigate,
    convLoading,
    chatCandidates,
  ]);

  const {
    messages,
    total: totalMessages,
    isLoading: msgLoading,
    loadMore: loadMoreMessages,
    loadingMore: loadingMoreMessages,
    hasMore: hasMoreMessages,
  } = useChatMessages(
    username ?? "",
    selectedParticipants,
    Boolean(selectedParticipants),
  );

  const canSend = !!hasAction(convActions, "send");
  const canArchive = !!hasAction(convActions, "archive");

  const handleArchiveAll = useCallback(async () => {
    await archiveAllChat(username ?? "");
    await refreshConversations();
  }, [username, refreshConversations]);

  const handleSendMessage = useCallback(
    async (message: string, files?: File[]) => {
      if (!selectedParticipants) return;

      if (files) {
        for (const file of files) {
          if (file.size > MAX_ATTACHMENT_SIZE) {
            throw new Error(
              `File "${file.name}" is ${formatFileSize(file.size)}, which exceeds the ${formatFileSize(MAX_ATTACHMENT_SIZE)} limit`,
            );
          }
        }
      }

      // Extract recipient IDs from participant usernames (exclude current agent)
      const toIds = selectedParticipants
        .split(",")
        .filter((name) => name !== username)
        .map((name) => agents.find((a) => a.name === name)?.id)
        .filter((id): id is number => id !== undefined);

      const result = await sendChatMessage(
        username ?? "",
        {
          fromId: agentId,
          toIds,
          message,
        },
        files,
      );

      if (!result.success) {
        throw new Error(result.message ?? "Failed to send message");
      }
    },
    [username, agentId, agents, selectedParticipants],
  );

  const handleNewChat = useCallback(
    (toIds: number[]) => {
      // Build participants string from usernames (sorted alphabetically)
      const allNames = [agentId, ...toIds]
        .map((id) => agents.find((a) => a.id === id)?.name ?? "")
        .filter(Boolean)
        .sort();
      const others = allNames.filter((n) => n !== username).join(",");

      void navigate(`/agents/${username}/chat/${others}`);
      closeDrawer();
    },
    [agentId, agents, username, closeDrawer, navigate],
  );

  const otherParticipantNames = useMemo(
    () =>
      selectedParticipants?.split(",").filter((name) => name !== username) ??
      [],
    [selectedParticipants, username],
  );

  const handleSwitchPerspective = useCallback(
    (name: string) => {
      if (!username) return;
      const newOthers = otherParticipantNames
        .filter((n) => n !== name)
        .concat(username);
      void navigate(`/agents/${name}/chat/${newOthers.join(",")}`);
    },
    [username, otherParticipantNames, navigate],
  );

  if (!username) {
    return (
      <Stack gap="md">
        <Text size="xl" fw={600}>
          Chat
        </Text>
        <Text c="dimmed" ta="center">
          Select an agent from the sidebar to view their chat
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

  if (convLoading && conversations.length === 0) {
    return <Loader size="lg" />;
  }

  const conversationList = (
    <ChatConversationList
      conversations={conversations}
      activeParticipants={selectedParticipants}
      onNavLinkClick={closeDrawer}
      onNewChat={handleNewChat}
      canSend={canSend}
      agents={agents}
      currentAgentId={agentId}
      agentName={username}
      totalConversations={totalConversations}
      hasMore={hasMoreConversations}
      loadingMore={loadingMoreConversations}
      onLoadMore={loadMoreConversations}
      canArchive={canArchive}
      onArchiveAll={handleArchiveAll}
      chatCandidates={chatCandidates}
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
        title="Conversations"
        size={SIDEBAR_WIDTH}
      >
        {conversationList}
      </Drawer>

      {/* Chat thread + input */}
      <Box
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {convError && (
          <Alert color="red" title="Error" m="xs">
            {String(convError)}
          </Alert>
        )}

        {!selectedParticipants ? (
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
              <IconMessageCircle size="1.2rem" />
            </ActionIcon>
            <Text c="dimmed">Select a conversation or start a new chat</Text>
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
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <ActionIcon variant="subtle" color="gray" component="span">
                  <IconMessageCircle size="1.2rem" />
                </ActionIcon>
              </UnstyledButton>
              <ParticipantInfo
                names={otherParticipantNames}
                agents={agents}
                onSwitch={handleSwitchPerspective}
              />
            </Group>

            {msgLoading && messages.length === 0 ? (
              <Box
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Loader size="md" />
              </Box>
            ) : (
              <ChatThread
                messages={messages}
                currentAgentId={agentId}
                total={totalMessages}
                hasMore={hasMoreMessages}
                loadingMore={loadingMoreMessages}
                onLoadMore={loadMoreMessages}
              />
            )}
            {canSend && (
              <ChatInput
                onSend={handleSendMessage}
                disabled={!selectedParticipants}
                focusKey={selectedParticipants}
                recipients={otherParticipantNames}
                showImpersonationWarning={
                  !!agent.shellModel && agent.shellModel !== "none"
                }
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
};
