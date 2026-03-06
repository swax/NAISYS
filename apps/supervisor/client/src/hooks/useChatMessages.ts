import type { HateoasAction } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import { ChatMessagesParams, getChatMessages } from "../lib/apiChat";
import type { ChatMessage } from "../lib/apiClient";
import { mergeIntoCache, MessageRoomEvent } from "./messageCacheUtils";
import { useSubscription } from "./useSubscription";

// Module-level caches (persist across remounts)
const messagesCache = new Map<string, ChatMessage[]>();
const updatedSinceCache = new Map<string, string | undefined>();
const totalCache = new Map<string, number>();
let actionsCache: HateoasAction[] | undefined = undefined;

export const useChatMessages = (
  agentId: number,
  participantIds: string | null,
  enabled: boolean = true,
) => {
  const { agents } = useAgentDataContext();
  const userLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const [, setCacheVersion] = useState(0);
  const cacheKey = `${agentId}:${participantIds}`;

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

  const handleChatPush = useCallback(
    (event: MessageRoomEvent) => {
      switch (event.type) {
        case "new-message": {
          const msg: ChatMessage = {
            id: event.messageId,
            fromUserId: event.fromUserId,
            fromUsername:
              userLookup.get(event.fromUserId) ?? String(event.fromUserId),
            body: event.body,
            createdAt: event.createdAt,
          };
          mergeMessages([msg]);
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
    [cacheKey, mergeMessages, userLookup],
  );

  const queryFn = useCallback(async () => {
    if (!participantIds) throw new Error("No conversation selected");

    const params: ChatMessagesParams = {
      agentId,
      participantIds,
      updatedSince: updatedSinceCache.get(cacheKey),
      page: 1,
      count: 50,
    };

    return await getChatMessages(params);
  }, [agentId, participantIds, cacheKey]);

  const query = useQuery({
    queryKey: ["chat-messages", agentId, participantIds],
    queryFn,
    enabled: enabled && !!agentId && !!participantIds,
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
    enabled && agentId && participantIds
      ? `chat-messages:${participantIds}`
      : null,
    handleChatPush,
  );

  const messages = messagesCache.get(cacheKey) || [];
  const total = totalCache.get(cacheKey) || 0;

  return {
    messages,
    total,
    actions: actionsCache,
    isLoading: query.isLoading,
    error: query.error,
  };
};
