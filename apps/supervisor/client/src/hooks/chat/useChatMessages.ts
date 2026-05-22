import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { getChatMessages } from "../../lib/api/apiChat";
import type { ChatMessage } from "../../lib/api/apiClient";
import { queryKeys } from "../../lib/api/queryKeys";
import { useAgentLookups } from "../data/useAgentLookups";
import {
  type ListInfiniteData,
  prependToPage0,
  updateItems,
} from "../infinite/pageCache";
import { useInfiniteListGapRecovery } from "../infinite/useInfiniteListGapRecovery";
import { useLiveInfiniteList } from "../infinite/useLiveInfiniteList";
import type { MessageRoomEvent } from "../socket/messageRoomEvents";
import { useSubscription } from "../socket/useSubscription";

/** Page size for the initial fetch and each `loadMore`. */
const PAGE_SIZE = 50;

const messageKey = (m: ChatMessage) => m.id;
const messageSortValue = (m: ChatMessage) => new Date(m.createdAt).getTime();

/**
 * A live, paginated chat thread, backed by `useLiveInfiniteList`. The
 * `chat-messages:${participants}` socket room keeps it current — a new message
 * is spliced onto page 0, a read receipt folded across every page. A missing
 * `previousMessageId` means a push was dropped, so the thread reconciles with
 * a refetch.
 */
export const useChatMessages = (
  agentUsername: string,
  participants: string | null,
  enabled: boolean = true,
) => {
  const { userLookup, titleLookup } = useAgentLookups();
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => queryKeys.chatThread(agentUsername, participants),
    [agentUsername, participants],
  );

  const list = useLiveInfiniteList<ChatMessage>({
    queryKey,
    enabled: enabled && !!agentUsername && !!participants,
    fetchPage: async (page) => {
      if (!participants) throw new Error("No conversation selected");
      const result = await getChatMessages({
        agentUsername,
        participants,
        page,
        count: PAGE_SIZE,
      });
      return {
        items: result.messages,
        total: result.total ?? 0,
        actions: result._actions,
      };
    },
    getItemKey: messageKey,
    getRecency: messageKey,
    getSortValue: messageSortValue,
    descending: false,
  });

  const checkGap = useInfiniteListGapRecovery(
    queryKey,
    messageKey,
    "useChatMessages",
  );

  const handleChatPush = useCallback(
    (event: MessageRoomEvent) => {
      switch (event.type) {
        case "new-message": {
          const msg: ChatMessage = {
            id: event.messageId,
            fromUserId: event.fromUserId,
            fromUsername:
              userLookup.get(event.fromUserId) ?? String(event.fromUserId),
            fromTitle: titleLookup.get(event.fromUserId) ?? "",
            body: event.body,
            createdAt: event.createdAt,
            attachments: event.attachments as ChatMessage["attachments"],
            source: event.source,
          };
          queryClient.setQueryData<ListInfiniteData<ChatMessage>>(
            queryKey,
            (old) => prependToPage0(old, msg, messageKey),
          );
          checkGap(event.previousMessageId, event.messageId);
          break;
        }
        case "read-receipt": {
          queryClient.setQueryData<ListInfiniteData<ChatMessage>>(
            queryKey,
            (old) =>
              updateItems(old, (m) => {
                if (!event.messageIds.includes(m.id)) return m;
                const readBy = m.readBy ?? [];
                if (readBy.includes(event.userId)) return m;
                return { ...m, readBy: [...readBy, event.userId] };
              }),
          );
          break;
        }
      }
    },
    [queryClient, queryKey, checkGap, userLookup, titleLookup],
  );

  useSubscription<MessageRoomEvent>(
    enabled && agentUsername && participants
      ? `chat-messages:${participants}`
      : null,
    handleChatPush,
  );

  return {
    messages: list.items,
    total: list.total,
    actions: list.actions,
    isLoading: list.isLoading,
    error: list.error,
    loadMore: list.loadMore,
    loadingMore: list.loadingMore,
    hasMore: list.hasMore,
  };
};
