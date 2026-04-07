import type { HateoasAction } from "@naisys/common";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import type { ChatMessagesParams } from "../lib/apiChat";
import { getChatMessages } from "../lib/apiChat";
import type { ChatMessage } from "../lib/apiClient";
import type { MessageRoomEvent } from "./messageCacheUtils";
import { mergeIntoCache } from "./messageCacheUtils";
import { useSubscription } from "./useSubscription";

// Module-level caches (persist across remounts)
const messagesCache = new Map<string, ChatMessage[]>();
const updatedSinceCache = new Map<string, string | undefined>();
const totalCache = new Map<string, number>();
const pagesLoadedCache = new Map<string, number>();
let actionsCache: HateoasAction[] | undefined = undefined;

// Tracks gap recovery attempts per cache key to prevent re-fetch loops
const gapRecoveryAttempted = new Map<string, Set<string>>();

export const useChatMessages = (
  agentUsername: string,
  participants: string | null,
  enabled: boolean = true,
) => {
  const { agents } = useAgentDataContext();
  const userLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const titleLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.title])),
    [agents],
  );
  const [, setCacheVersion] = useState(0);
  const cacheKey = `${agentUsername}:${participants}`;
  const queryClient = useQueryClient();

  // Clean up gap recovery state when leaving a conversation
  useEffect(() => {
    return () => {
      gapRecoveryAttempted.delete(cacheKey);
    };
  }, [cacheKey]);

  const mergeMessages = useCallback(
    (newMessages: ChatMessage[], total?: number) => {
      if (
        mergeIntoCache(
          cacheKey,
          newMessages,
          total,
          messagesCache,
          totalCache,
          updatedSinceCache,
          false,
        )
      ) {
        setCacheVersion((v) => v + 1);
      }
    },
    [cacheKey],
  );

  const recoverMessages = useCallback(
    (previousMessageId: number, currentMessageId: number) => {
      const gapKey = `${previousMessageId}-${currentMessageId}`;
      const attempted = gapRecoveryAttempted.get(cacheKey) ?? new Set();
      if (attempted.has(gapKey)) return;
      attempted.add(gapKey);
      gapRecoveryAttempted.set(cacheKey, attempted);

      console.info(
        `[useChatMessages] Gap recovery for ${cacheKey}: clearing cache and refetching`,
      );

      // Clear timestamp so next fetch gets all messages
      updatedSinceCache.delete(cacheKey);
      void queryClient.invalidateQueries({
        queryKey: ["chat-messages", agentUsername, participants],
      });
    },
    [cacheKey, agentUsername, participants, queryClient],
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
          };
          mergeMessages([msg]);

          // Gap detection: check if previousMessageId exists in cache
          if (event.previousMessageId != null) {
            const cached = messagesCache.get(cacheKey);
            if (cached && cached.length > 0) {
              const hasPrevious = cached.some(
                (m) => m.id === event.previousMessageId,
              );
              if (!hasPrevious) {
                console.warn(
                  `[useChatMessages] Gap detected in ${cacheKey}: missing previousMessageId ${event.previousMessageId}`,
                );
                recoverMessages(event.previousMessageId, event.messageId);
              }
            }
          }
          break;
        }
        case "read-receipt": {
          const cached = messagesCache.get(cacheKey);
          if (!cached) return;

          let changed = false;
          for (const msg of cached) {
            if (event.messageIds.includes(msg.id)) {
              const readBy = msg.readBy ?? [];
              if (!readBy.includes(event.userId)) {
                msg.readBy = [...readBy, event.userId];
                changed = true;
              }
            }
          }
          if (changed) setCacheVersion((v) => v + 1);
          break;
        }
      }
    },
    [cacheKey, mergeMessages, recoverMessages, userLookup, titleLookup],
  );

  const queryFn = useCallback(async () => {
    if (!participants) throw new Error("No conversation selected");

    const params: ChatMessagesParams = {
      agentUsername,
      participants,
      updatedSince: updatedSinceCache.get(cacheKey),
      page: 1,
      count: 50,
    };

    return await getChatMessages(params);
  }, [agentUsername, participants, cacheKey]);

  const query = useQuery({
    queryKey: ["chat-messages", agentUsername, participants],
    queryFn,
    enabled: enabled && !!agentUsername && !!participants,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: 1000,
  });

  // Merge REST data when it arrives
  useEffect(() => {
    if (query.data?._actions) {
      actionsCache = query.data._actions;
    }
    if (query.data?.success && query.data.messages) {
      mergeMessages(query.data.messages, query.data.total);
    }
  }, [query.data, mergeMessages]);

  // WebSocket subscription for real-time chat message and read receipt updates
  useSubscription<MessageRoomEvent>(
    enabled && agentUsername && participants
      ? `chat-messages:${participants}`
      : null,
    handleChatPush,
  );

  // Load more (next page of historical data)
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !participants) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = (pagesLoadedCache.get(cacheKey) || 1) + 1;
      const result = await getChatMessages({
        agentUsername,
        participants,
        page: nextPage,
        count: 50,
      });
      if (result.success && result.messages) {
        mergeMessages(result.messages, result.total);
        pagesLoadedCache.set(cacheKey, nextPage);
      }
    } catch (err) {
      console.error("Error loading more chat messages:", err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [agentUsername, participants, cacheKey, mergeMessages]);

  const messages = messagesCache.get(cacheKey) || [];
  const total = totalCache.get(cacheKey) || 0;
  const hasMore = messages.length < total;

  return {
    messages,
    total,
    actions: actionsCache,
    isLoading: query.isLoading,
    error: query.error,
    loadMore,
    loadingMore,
    hasMore,
  };
};
