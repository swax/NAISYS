import type { HateoasAction } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentDataContext } from "../contexts/AgentDataContext";
import { getChatConversations } from "../lib/apiChat";
import type { ChatConversation } from "../lib/apiClient";
import type { MessageRoomEvent } from "./messageCacheUtils";
import { useSubscription } from "./useSubscription";

// Module-level cache (shared across hook instances, persists across remounts)
const conversationsCache = new Map<string, ChatConversation[]>();
const totalCache = new Map<string, number>();
const pagesLoadedCache = new Map<string, number>();

export const useChatConversations = (
  agentUsername: string,
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

  const mergeConversations = useCallback(
    (updated: ChatConversation[], total?: number) => {
      if (updated.length === 0 && total === undefined) return;

      const existing = conversationsCache.get(agentUsername) || [];
      const mergeMap = new Map(existing.map((c) => [c.participants, c]));

      const existingCount = mergeMap.size;
      for (const conv of updated) {
        mergeMap.set(conv.participants, conv);
      }

      const merged = Array.from(mergeMap.values());
      const newCount = merged.length - existingCount;

      // Sort by latest message time (newest first)
      merged.sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime(),
      );

      conversationsCache.set(agentUsername, merged);

      if (total !== undefined) {
        totalCache.set(agentUsername, total);
      } else if (newCount > 0) {
        totalCache.set(
          agentUsername,
          (totalCache.get(agentUsername) || 0) + newCount,
        );
      }

      setCacheVersion((v) => v + 1);
    },
    [agentUsername],
  );

  const handleChatPush = useCallback(
    (event: MessageRoomEvent) => {
      if (event.type !== "new-message") return;

      const allIds = [
        ...new Set([...event.recipientUserIds, event.fromUserId]),
      ];
      const conv: ChatConversation = {
        participants: event.participants,
        participantNames: allIds.map((id) => userLookup.get(id) ?? String(id)),
        participantTitles: allIds.map((id) => titleLookup.get(id) ?? ""),
        lastMessage: event.body,
        lastMessageAt: event.createdAt,
        lastMessageFrom:
          userLookup.get(event.fromUserId) ?? String(event.fromUserId),
      };
      mergeConversations([conv]);
    },
    [mergeConversations, userLookup, titleLookup],
  );

  const query = useQuery({
    queryKey: ["chat-conversations", agentUsername],
    queryFn: () => getChatConversations({ agentUsername, page: 1, count: 50 }),
    enabled: enabled && !!agentUsername,
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
      mergeConversations(query.data.conversations, query.data.total);
    }
  }, [query.data, mergeConversations]);

  // WebSocket subscription for real-time conversation updates
  useSubscription<MessageRoomEvent>(
    enabled && agentUsername ? `chat-conversations:${agentUsername}` : null,
    handleChatPush,
  );

  // Load more (next page of conversations)
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = (pagesLoadedCache.get(agentUsername) || 1) + 1;
      const result = await getChatConversations({
        agentUsername,
        page: nextPage,
        count: 50,
      });
      if (result.conversations) {
        mergeConversations(result.conversations, result.total);
        pagesLoadedCache.set(agentUsername, nextPage);
      }
    } catch (err) {
      console.error("Error loading more conversations:", err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [agentUsername, mergeConversations]);

  const refresh = useCallback(async () => {
    conversationsCache.delete(agentUsername);
    totalCache.delete(agentUsername);
    pagesLoadedCache.delete(agentUsername);
    setCacheVersion((v) => v + 1);
    await query.refetch();
  }, [agentUsername, query]);

  const conversations = conversationsCache.get(agentUsername) || [];
  const total = totalCache.get(agentUsername) || 0;
  const hasMore = conversations.length < total;
  const actions: HateoasAction[] | undefined = query.data?._actions;

  return {
    conversations,
    total,
    actions,
    isLoading: query.isLoading,
    error: query.error,
    loadMore,
    loadingMore,
    hasMore,
    refresh,
  };
};
