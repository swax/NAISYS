import { ActionIcon, Alert, Box, Drawer, Group, Loader, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { hasAction } from "@naisys/common";
import { IconMessageCircle } from "@tabler/icons-react";
import React, { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useChatConversations } from "../../hooks/useChatConversations";
import { useChatMessages } from "../../hooks/useChatMessages";
import { sendChatMessage } from "../../lib/apiChat";
import { ChatConversationList } from "./ChatConversationList";
import { ChatInput } from "./ChatInput";
import { ChatThread } from "./ChatThread";

const SIDEBAR_WIDTH = 280;

export const AgentChat: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { agents } = useAgentDataContext();
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();

  const agentId = id ? Number(id) : 0;
  const agent = agents.find((a) => a.id === agentId);

  const [selectedParticipantIds, setSelectedParticipantIds] = useState<
    string | null
  >(null);

  const {
    conversations,
    actions: convActions,
    isLoading: convLoading,
    error: convError,
  } = useChatConversations(agentId, Boolean(id));

  const {
    messages,
    isLoading: msgLoading,
  } = useChatMessages(agentId, selectedParticipantIds, Boolean(selectedParticipantIds));

  const canSend = !!hasAction(convActions, "send");

  const handleSelectConversation = useCallback(
    (participantIds: string) => {
      setSelectedParticipantIds(participantIds);
      closeDrawer();
    },
    [closeDrawer],
  );

  const handleSendMessage = useCallback(
    async (message: string) => {
      if (!selectedParticipantIds) return;

      // Extract recipient IDs from participant IDs (exclude current agent)
      const toIds = selectedParticipantIds
        .split(",")
        .map(Number)
        .filter((pid) => pid !== agentId);

      await sendChatMessage(agentId, {
        fromId: agentId,
        toIds,
        message,
      });
    },
    [agentId, selectedParticipantIds],
  );

  const handleNewChat = useCallback(
    (toIds: number[]) => {
      // Build participant IDs string (sorted)
      const allIds = [agentId, ...toIds].sort((a, b) => a - b);
      const participantIds = allIds.join(",");

      // Select this conversation (it may or may not exist yet)
      setSelectedParticipantIds(participantIds);
      closeDrawer();
    },
    [agentId, closeDrawer],
  );

  if (!id) {
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
        Agent with ID {id} not found
      </Alert>
    );
  }

  if (convLoading && conversations.length === 0) {
    return <Loader size="lg" />;
  }

  const conversationList = (
    <ChatConversationList
      conversations={conversations}
      selectedParticipantIds={selectedParticipantIds}
      onSelect={handleSelectConversation}
      onNewChat={handleNewChat}
      canSend={canSend}
      agents={agents}
      currentAgentId={agentId}
    />
  );

  return (
    <Box
      style={{
        display: "flex",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Desktop conversation sidebar */}
      <Box
        visibleFrom="sm"
        style={{
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          borderRight: "1px solid var(--mantine-color-dark-4)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {conversationList}
      </Box>

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

        {/* Mobile conversation toggle */}
        <Box hiddenFrom="sm" p="xs" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
          <ActionIcon variant="subtle" color="gray" onClick={openDrawer}>
            <IconMessageCircle size="1.2rem" />
          </ActionIcon>
        </Box>

        {!selectedParticipantIds ? (
          <Box
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
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
              <Text size="sm" fw={600}>
                {selectedParticipantIds
                  ?.split(",")
                  .map(Number)
                  .filter((pid) => pid !== agentId)
                  .map((pid) => agents.find((a) => a.id === pid)?.name ?? `#${pid}`)
                  .join(", ")}
              </Text>
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
              />
            )}
            {canSend && (
              <ChatInput
                onSend={handleSendMessage}
                disabled={!selectedParticipantIds}
                focusKey={selectedParticipantIds}
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
};
