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
import { useQueryClient } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { CollapsibleSidebar } from "../../components/CollapsibleSidebar";
import { AgentPauseToggle } from "../../components/feature/AgentPauseToggle";
import { ParticipantInfo } from "../../components/feature/ParticipantInfo";
import { VoiceMicButton } from "../../components/feature/VoiceMicButton";
import { SIDEBAR_WIDTH } from "../../constants";
import { useAgentDataContext } from "../../contexts/AgentDataContext";
import { useChatConversations } from "../../hooks/chat/useChatConversations";
import { useChatMessages } from "../../hooks/chat/useChatMessages";
import type { ThreadRun } from "../../hooks/thread-runs/useMessageThreadRuns";
import { useMessageThreadRuns } from "../../hooks/thread-runs/useMessageThreadRuns";
import { buildAgentCandidates } from "../../lib/agentCandidates";
import { archiveAllChat, sendChatMessage } from "../../lib/api/apiChat";
import { ChatConversationList } from "./ChatConversationList";
import { ChatInput } from "./ChatInput";
import { ChatThread } from "./ChatThread";

export const AgentChat: React.FC = () => {
  const { username, participants: participantsParam } = useParams<{
    username: string;
    participants: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { agents } = useAgentDataContext();
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure();

  const agent = agents.find((a) => a.name === username);
  const agentId = agent?.id ?? 0;

  // Derive selectedParticipants from URL param by adding current agent back
  const selectedParticipants = useMemo(() => {
    if (!participantsParam || !username) return null;
    const names = new Set(participantsParam.split(",").filter(Boolean));
    names.add(username);
    return [...names].sort().join(",");
  }, [participantsParam, username]);

  // Accept full participant keys in direct links/back history, but keep the
  // visible URL in the route's "other participants only" format.
  useEffect(() => {
    if (!participantsParam || !username) return;

    const canonicalOthers = [
      ...new Set(participantsParam.split(",").filter(Boolean)),
    ]
      .filter((name) => name !== username)
      .sort()
      .join(",");

    if (participantsParam === canonicalOthers) return;

    const target = canonicalOthers
      ? `/agents/${username}/chat/${canonicalOthers}`
      : `/agents/${username}/chat`;
    void navigate(target, { replace: true });
  }, [participantsParam, username, navigate]);

  const {
    conversations,
    total: totalConversations,
    actions: convActions,
    isLoading: convLoading,
    isFetchedAfterMount: convFetchedAfterMount,
    error: convError,
    loadMore: loadMoreConversations,
    loadingMore: loadingMoreConversations,
    hasMore: hasMoreConversations,
    refresh: refreshConversations,
  } = useChatConversations(username ?? "", Boolean(username));

  // Build list of agents to show under "Start a chat with", excluding
  // partners we already have a 1:1 conversation with. Server strips the
  // current user from participantNames, so a 1:1 has length 1.
  const chatCandidates = useMemo(() => {
    if (!username) return [];
    const existingPartners = new Set<string>();
    for (const conv of conversations) {
      if (conv.participantNames.length === 1) {
        existingPartners.add(conv.participantNames[0]);
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
    if (!convFetchedAfterMount) return;

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
    convFetchedAfterMount,
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

  // Shared by the thread (for activity rows, phantom bubbles, etc.) and the
  // input footer (for the pause/resume buttons next to the textarea).
  const threadParticipants = useMemo(
    () =>
      selectedParticipants
        ? selectedParticipants.split(",").filter(Boolean)
        : [],
    [selectedParticipants],
  );
  const { runs: threadRuns, patchRun: patchThreadRun } = useMessageThreadRuns(
    "chat",
    username ?? "",
    threadParticipants,
  );

  // One pause/resume button per online parent run belonging to an "other"
  // participant. Operators pause the agent they're talking to, not themselves.
  // Multiple online parent runs for the same agent are unusual; first wins.
  const pauseableRuns = useMemo(() => {
    const byUsername = new Map<string, ThreadRun>();
    for (const r of threadRuns) {
      if (!r.isOnline) continue;
      if (r.subagentId != null && r.subagentId !== 0) continue;
      if (!r.username || r.username === username) continue;
      if (byUsername.has(r.username)) continue;
      byUsername.set(r.username, r);
    }
    return Array.from(byUsername.values()).sort((a, b) =>
      (a.username ?? "").localeCompare(b.username ?? ""),
    );
  }, [threadRuns, username]);

  // Phase 1 voice sessions operate exactly one NAISYS agent. The button stays
  // visible but disables-with-tooltip outside strict 1:1 with one LLM-driven
  // agent (humans-only, multi-agent, 1 agent + extra humans, or an agent like
  // admin that has shellModel "none" and so can't run commands the voice
  // agent's tools need).
  const otherParticipants = threadParticipants.filter((n) => n !== username);
  const otherAgents = otherParticipants
    .map((n) => agents.find((a) => a.name === n))
    .filter((a): a is NonNullable<typeof a> => a !== undefined);
  const voiceTargetAgent =
    otherParticipants.length === 1 && otherAgents.length === 1
      ? otherAgents[0]
      : undefined;
  let voiceDisabledReason: string | undefined;
  if (otherParticipants.length > 0 && otherAgents.length === 0) {
    voiceDisabledReason =
      "Voice is only available in conversations with a NAISYS agent.";
  } else if (!voiceTargetAgent) {
    voiceDisabledReason =
      "Voice operates a single agent — switch to a 1:1 chat with the agent you want to operate.";
  } else if (voiceTargetAgent.shellModel === "none") {
    voiceDisabledReason = `${voiceTargetAgent.name} has no shell model — voice operates LLM-driven agents that can run commands.`;
  }

  const inputLeftSection = (
    <>
      {pauseableRuns.map((run) => (
        <AgentPauseToggle
          key={`${run.userId}-${run.runId}-${run.sessionId}-${run.subagentId ?? 0}`}
          username={run.username!}
          runId={run.runId}
          sessionId={run.sessionId}
          subagentId={run.subagentId}
          paused={run.paused ?? false}
          onPauseChanged={(paused) =>
            patchThreadRun(
              run.userId,
              run.runId,
              run.sessionId,
              run.subagentId,
              { paused },
            )
          }
          tooltipLabel={(p) => `${p ? "Resume" : "Pause"} ${run.username}`}
        />
      ))}
    </>
  );

  const inputRightSection =
    username && otherParticipants.length > 0 ? (
      <VoiceMicButton
        fromUsername={username}
        fromTitle={agent?.title ?? username}
        targetUsername={voiceTargetAgent?.name ?? otherParticipants[0]}
        targetTitle={voiceTargetAgent?.title ?? otherParticipants[0]}
        mode="chat"
        disabledReason={voiceDisabledReason}
      />
    ) : null;

  // Browser back/forward can reuse this route component with the module-level
  // message cache already populated. Revalidate the active thread whenever the
  // route entry is activated so missed socket pushes are backfilled promptly.
  useEffect(() => {
    if (!username || !selectedParticipants) return;

    void queryClient.invalidateQueries({
      queryKey: ["chat-messages", username, selectedParticipants],
      refetchType: "active",
    });
  }, [location.key, queryClient, selectedParticipants, username]);

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
                currentAgentUsername={username}
                total={totalMessages}
                hasMore={hasMoreMessages}
                loadingMore={loadingMoreMessages}
                onLoadMore={loadMoreMessages}
                participants={threadParticipants}
                runs={threadRuns}
              />
            )}
            {canSend && (
              <ChatInput
                onSend={handleSendMessage}
                disabled={!selectedParticipants}
                focusKey={selectedParticipants}
                historyKey={
                  username && selectedParticipants
                    ? `chat:${username}|${selectedParticipants}`
                    : null
                }
                recipients={otherParticipantNames}
                showImpersonationWarning={
                  !!agent.shellModel && agent.shellModel !== "none"
                }
                leftSection={inputLeftSection}
                rightSection={inputRightSection}
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
};
