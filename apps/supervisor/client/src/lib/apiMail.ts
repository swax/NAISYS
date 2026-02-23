import type {
  MailDataResponse,
  SendMailRequest,
  SendMailResponse,
} from "./apiClient";
import { api, API_BASE, apiEndpoints } from "./apiClient";

export interface MailDataParams {
  agentId: number;
  updatedSince?: string;
  page?: number;
  count?: number;
}

export const getMailData = async (
  params: MailDataParams,
): Promise<MailDataResponse> => {
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
  const url = `${apiEndpoints.agentMail(params.agentId)}${query ? `?${query}` : ""}`;
  return await api.get<MailDataResponse>(url);
};

export const sendMail = async (
  agentId: number,
  mailData: SendMailRequest & { files?: File[] },
): Promise<SendMailResponse> => {
  try {
    const endpoint = apiEndpoints.agentMail(agentId);

    // If there are files, use FormData
    if (mailData.files && mailData.files.length > 0) {
      const formData = new FormData();
      formData.append("fromId", String(mailData.fromId));
      formData.append("toId", String(mailData.toId));
      formData.append("subject", mailData.subject);
      formData.append("message", mailData.message);

      // Add files to FormData
      mailData.files.forEach((file) => {
        formData.append(`attachments`, file);
      });

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || `API Error: ${response.status}`);
      }
      return result;
    } else {
      // No files, use regular JSON request
      const { files: _files, ...body } = mailData;
      return await api.post<SendMailRequest, SendMailResponse>(endpoint, body);
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to send mail",
    };
  }
};
