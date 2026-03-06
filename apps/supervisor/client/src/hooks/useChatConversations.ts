import type { HateoasAction } from "@naisys/common";
import type { MailPush } from "@naisys/hub-protocol";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import { getChatConversations } from "../lib/apiChat";
import type { ChatConversation } from "../lib/apiClient";
import { useSubscription } from "./useSubscription";

// Module-level cache (shared across hook instances, persists across remounts)
const conversationsCache = new Map<number, ChatConversation[]>();

export const useChatConversations = (
  agentId: number,
  enabled: boolean = true,
) => {
  const { agents } = useAgentDataContext();
  const userLookup = useMemo(
    () => new Map(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const [, setCacheVersion] = useState(0);

  const mergeConversations = useCallback(
    (updated: ChatConversation[]) => {
      if (updated.length === 0) return;

      const existing = conversationsCache.get(agentId) || [];
      const mergeMap = new Map(existing.map((c) => [c.participantIds, c]));

      for (const conv of updated) {
        mergeMap.set(conv.participantIds, conv);
      }

      const merged = Array.from(mergeMap.values());

      // Sort by latest message time (newest first)
      merged.sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime(),
      );

      conversationsCache.set(agentId, merged);
      setCacheVersion((v) => v + 1);
    },
    [agentId],
  );

  const handleChatPush = useCallback(
    (event: MailPush) => {
      const allIds = [
        ...new Set([...event.recipientUserIds, event.fromUserId]),
      ];
      const conv: ChatConversation = {
        participantIds: event.participantIds,
        participantNames: allIds.map((id) => userLookup.get(id) ?? String(id)),
        lastMessage: event.body,
        lastMessageAt: event.createdAt,
        lastMessageFrom:
          userLookup.get(event.fromUserId) ?? String(event.fromUserId),
      };
      mergeConversations([conv]);
    },
    [mergeConversations, userLookup],
  );

  const query = useQuery({
    queryKey: ["chat-conversations", agentId],
    queryFn: () => getChatConversations(agentId),
    enabled: enabled && !!agentId,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: 1000,
  });

  // Merge REST data when it arrives
  useEffect(() => {
    if (query.data?.conversations) {
      mergeConversations(query.data.conversations);
    }
  }, [query.data, mergeConversations]);

  // WebSocket subscription for real-time conversation updates
  useSubscription<MailPush>(
    enabled && agentId ? `chat-conversations:${agentId}` : null,
    handleChatPush,
  );

  const conversations = conversationsCache.get(agentId) || [];
  const actions: HateoasAction[] | undefined = query.data?._actions;

  return {
    conversations,
    actions,
    isLoading: query.isLoading,
    error: query.error,
  };
};
