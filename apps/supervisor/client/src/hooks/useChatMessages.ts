import type { HateoasAction } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { MailPush } from "@naisys/hub-protocol";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import { ChatMessagesParams, getChatMessages } from "../lib/apiChat";
import type { ChatMessage } from "../lib/apiClient";
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
      if (newMessages.length === 0 && total === undefined) return;

      const existing = messagesCache.get(cacheKey) || [];
      const mergeMap = new Map(existing.map((m) => [m.id, m]));

      const existingCount = mergeMap.size;
      for (const msg of newMessages) {
        mergeMap.set(msg.id, msg);
      }

      const merged = Array.from(mergeMap.values());
      const newCount = merged.length - existingCount;

      // Sort chronologically (oldest first for chat)
      merged.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

      messagesCache.set(cacheKey, merged);

      if (total !== undefined) {
        totalCache.set(cacheKey, total);
      } else if (newCount > 0) {
        const currentTotal = totalCache.get(cacheKey) || 0;
        totalCache.set(cacheKey, currentTotal + newCount);
      }

      updatedSinceCache.set(cacheKey, new Date().toISOString());
      setCacheVersion((v) => v + 1);
    },
    [cacheKey],
  );

  const handleChatPush = useCallback(
    (event: MailPush) => {
      const msg: ChatMessage = {
        id: event.messageId,
        fromUserId: event.fromUserId,
        fromUsername:
          userLookup.get(event.fromUserId) ?? String(event.fromUserId),
        body: event.body,
        createdAt: event.createdAt,
      };
      mergeMessages([msg]);
    },
    [mergeMessages, userLookup],
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

  // WebSocket subscription for real-time chat message updates
  useSubscription<MailPush>(
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
