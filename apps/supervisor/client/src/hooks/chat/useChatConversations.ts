import { unique } from "@naisys/common";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { getChatConversations } from "../../lib/api/apiChat";
import type { ChatConversation } from "../../lib/api/apiClient";
import { queryKeys } from "../../lib/api/queryKeys";
import { useAgentLookups } from "../data/useAgentLookups";
import { type ListInfiniteData, moveToTopOfPage0 } from "../infinite/pageCache";
import { useLiveInfiniteList } from "../infinite/useLiveInfiniteList";
import type { MessageRoomEvent } from "../socket/messageRoomEvents";
import { useSubscription } from "../socket/useSubscription";

/** Page size for the initial fetch and each `loadMore`. */
const PAGE_SIZE = 50;

const conversationKey = (c: ChatConversation) => c.participants;
const conversationRecency = (c: ChatConversation) =>
  new Date(c.lastMessageAt).getTime();

/**
 * A live, paginated list of an agent's chat conversations, backed by
 * `useLiveInfiniteList`. The `chat-conversations:${username}` socket room keeps
 * it current — a new message moves its conversation to the top. Conversations
 * are keyed by their `participants` string.
 */
export const useChatConversations = (
  agentUsername: string,
  enabled: boolean = true,
) => {
  const { userLookup, titleLookup } = useAgentLookups();
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => queryKeys.chatConversations(agentUsername),
    [agentUsername],
  );

  const list = useLiveInfiniteList<ChatConversation>({
    queryKey,
    enabled: enabled && !!agentUsername,
    fetchPage: async (page) => {
      const result = await getChatConversations({
        agentUsername,
        page,
        count: PAGE_SIZE,
      });
      return {
        items: result.conversations,
        total: result.total ?? 0,
        actions: result._actions,
      };
    },
    getItemKey: conversationKey,
    getRecency: conversationRecency,
    getSortValue: conversationRecency,
    descending: true,
  });

  const handleChatPush = useCallback(
    (event: MessageRoomEvent) => {
      if (event.type !== "new-message") return;

      const allIds = unique([...event.recipientUserIds, event.fromUserId]);
      // Match the server: drop the current agent from participantNames so a
      // 1:1 conversation has length 1 (the sidebar title and candidate filter
      // rely on it).
      const otherIds = allIds.filter(
        (id) => userLookup.get(id) !== agentUsername,
      );
      const conv: ChatConversation = {
        participants: event.participants,
        participantNames: otherIds.map((id) => userLookup.get(id) ?? String(id)),
        participantTitles: otherIds.map((id) => titleLookup.get(id) ?? ""),
        lastMessage: event.body,
        lastMessageAt: event.createdAt,
        lastMessageFrom:
          userLookup.get(event.fromUserId) ?? String(event.fromUserId),
      };
      queryClient.setQueryData<ListInfiniteData<ChatConversation>>(
        queryKey,
        (old) => moveToTopOfPage0(old, conv, conversationKey),
      );
    },
    [agentUsername, queryClient, queryKey, userLookup, titleLookup],
  );

  useSubscription<MessageRoomEvent>(
    enabled && agentUsername ? `chat-conversations:${agentUsername}` : null,
    handleChatPush,
  );

  return {
    conversations: list.items,
    total: list.total,
    actions: list.actions,
    isLoading: list.isLoading,
    isFetchedAfterMount: list.isFetchedAfterMount,
    error: list.error,
    loadMore: list.loadMore,
    loadingMore: list.loadingMore,
    hasMore: list.hasMore,
    refresh: list.refresh,
  };
};
