import type {
  ChatConversationsResponse,
  ChatMessagesResponse,
  SendChatRequest,
  SendChatResponse,
} from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

export const getChatConversations = async (
  agentId: number,
): Promise<ChatConversationsResponse> => {
  return await api.get<ChatConversationsResponse>(
    apiEndpoints.agentChat(agentId),
  );
};

export interface ChatMessagesParams {
  agentId: number;
  participantIds: string;
  updatedSince?: string;
  page?: number;
  count?: number;
}

export const getChatMessages = async (
  params: ChatMessagesParams,
): Promise<ChatMessagesResponse> => {
  const queryParams = new URLSearchParams();
  if (params.updatedSince) {
    queryParams.append("updatedSince", params.updatedSince);
  }
  if (params.page !== undefined) {
    queryParams.append("page", params.page.toString());
  }
  if (params.count !== undefined) {
    queryParams.append("count", params.count.toString());
  }

  const query = queryParams.toString();
  const url = `${apiEndpoints.agentChatMessages(params.agentId, params.participantIds)}${query ? `?${query}` : ""}`;
  return await api.get<ChatMessagesResponse>(url);
};

export const sendChatMessage = async (
  agentId: number,
  data: SendChatRequest,
): Promise<SendChatResponse> => {
  try {
    return await api.post<SendChatRequest, SendChatResponse>(
      apiEndpoints.agentChat(agentId),
      data,
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to send chat message",
    };
  }
};
