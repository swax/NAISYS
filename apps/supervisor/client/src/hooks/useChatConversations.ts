import type { HateoasAction } from "@naisys/common";
import { useQuery } from "@tanstack/react-query";

import { getChatConversations } from "../lib/apiChat";
import type { ChatConversation } from "../lib/apiClient";

export const useChatConversations = (
  agentId: number,
  enabled: boolean = true,
) => {
  const query = useQuery({
    queryKey: ["chat-conversations", agentId],
    queryFn: () => getChatConversations(agentId),
    enabled: enabled && !!agentId,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: 1000,
  });

  const conversations: ChatConversation[] = query.data?.conversations ?? [];
  const actions: HateoasAction[] | undefined = query.data?._actions;

  return {
    conversations,
    actions,
    isLoading: query.isLoading,
    error: query.error,
  };
};
