import type {
  ChatConversationsResponse,
  ChatMessagesResponse,
  SendChatRequest,
  SendChatResponse,
} from "./apiClient";
import { api, API_BASE, apiEndpoints } from "./apiClient";

export interface ChatConversationsParams {
  agentUsername: string;
  page?: number;
  count?: number;
}

export const getChatConversations = async (
  params: ChatConversationsParams,
): Promise<ChatConversationsResponse> => {
  const queryParams = new URLSearchParams();
  if (params.page !== undefined) {
    queryParams.append("page", params.page.toString());
  }
  if (params.count !== undefined) {
    queryParams.append("count", params.count.toString());
  }

  const query = queryParams.toString();
  const url = `${apiEndpoints.agentChat(params.agentUsername)}${query ? `?${query}` : ""}`;
  return await api.get<ChatConversationsResponse>(url);
};

export interface ChatMessagesParams {
  agentUsername: string;
  participants: string;
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
  const url = `${apiEndpoints.agentChatMessages(params.agentUsername, params.participants)}${query ? `?${query}` : ""}`;
  return await api.get<ChatMessagesResponse>(url);
};

export const sendChatMessage = async (
  agentUsername: string,
  data: SendChatRequest,
  files?: File[],
): Promise<SendChatResponse> => {
  try {
    if (files && files.length > 0) {
      const formData = new FormData();
      formData.append("fromId", String(data.fromId));
      formData.append("toIds", JSON.stringify(data.toIds));
      formData.append("message", data.message);

      for (const file of files) {
        formData.append("attachments", file);
      }

      const response = await fetch(
        `${API_BASE}${apiEndpoints.agentChat(agentUsername)}`,
        {
          method: "POST",
          body: formData,
        },
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || `API Error: ${response.status}`);
      }
      return result;
    } else {
      return await api.post<SendChatRequest, SendChatResponse>(
        apiEndpoints.agentChat(agentUsername),
        data,
      );
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to send chat message",
    };
  }
};
