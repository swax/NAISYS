import type { MultipartFile, MultipartValue } from "@fastify/multipart";
import type {
  AgentUsernameParams,
  ArchiveChatResponse,
  ChatConversationsRequest,
  ChatConversationsResponse,
  ChatMessagesRequest,
  ChatMessagesResponse,
  ErrorResponse,
  SendChatRequest,
  SendChatResponse,
} from "@naisys/supervisor-shared";
import {
  AgentUsernameParamsSchema,
  ArchiveChatResponseSchema,
  ChatConversationsRequestSchema,
  ChatConversationsResponseSchema,
  ChatMessagesRequestSchema,
  ChatMessagesResponseSchema,
  ErrorResponseSchema,
  SendChatRequestSchema,
  SendChatResponseSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { badRequest, notFound } from "../error-helpers.js";
import { API_PREFIX, timestampCursorLinks } from "../hateoas.js";
import { resolveAgentId } from "../services/agentService.js";
import { uploadToHub } from "../services/attachmentProxyService.js";
import {
  archiveAllChatMessages,
  getConversations,
  getMessages,
  sendChatMessage,
} from "../services/chatService.js";

function sendChatAction(username: string) {
  return {
    rel: "send",
    href: `${API_PREFIX}/agents/${username}/chat`,
    method: "POST" as const,
    title: "Send Chat Message",
    schema: `${API_PREFIX}/schemas/SendChat`,
    body: { fromId: 0, toIds: [0], message: "" },
    alternateEncoding: {
      contentType: "multipart/form-data",
      description: "Send as multipart to include file attachments",
      fileFields: ["attachments"],
    },
  };
}

function archiveChatAction(username: string) {
  return {
    rel: "archive",
    href: `${API_PREFIX}/agents/${username}/chat/archive`,
    method: "POST" as const,
    title: "Archive All Chat Messages",
  };
}

export default function agentChatRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:username/chat — List conversations for agent
  fastify.get<{
    Params: AgentUsernameParams;
    Querystring: ChatConversationsRequest;
    Reply: ChatConversationsResponse | ErrorResponse;
  }>(
    "/:username/chat",
    {
      schema: {
        description: "Get chat conversations for a specific agent",
        tags: ["Chat"],
        params: AgentUsernameParamsSchema,
        querystring: ChatConversationsRequestSchema,
        response: {
          200: ChatConversationsResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const { page, count } = request.query;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      const { conversations, total } = await getConversations(id, page, count);

      const canSend = hasPermission(
        request.supervisorUser,
        "agent_communication",
      );

      return {
        success: true,
        conversations,
        total,
        _actions: canSend
          ? [sendChatAction(username), archiveChatAction(username)]
          : undefined,
      };
    },
  );

  // GET /:username/chat/:participants — Messages in a conversation
  fastify.get<{
    Params: AgentUsernameParams & { participants: string };
    Querystring: ChatMessagesRequest;
    Reply: ChatMessagesResponse | ErrorResponse;
  }>(
    "/:username/chat/:participants",
    {
      schema: {
        description: "Get chat messages for a specific conversation",
        tags: ["Chat"],
        querystring: ChatMessagesRequestSchema,
        response: {
          200: ChatMessagesResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, _reply) => {
      const { username, participants } = request.params;
      const { updatedSince, updatedBefore, page, count } = request.query;

      const data = await getMessages(
        participants,
        updatedSince,
        updatedBefore,
        page,
        count,
      );

      const canSend = hasPermission(
        request.supervisorUser,
        "agent_communication",
      );

      const oldest = data.messages.length
        ? data.messages[data.messages.length - 1].createdAt
        : undefined;

      return {
        success: true,
        messages: data.messages,
        total: data.total,
        timestamp: data.timestamp,
        _links: timestampCursorLinks(
          `/agents/${username}/chat/${encodeURIComponent(participants)}`,
          data.timestamp,
          oldest,
        ),
        _actions: canSend ? [sendChatAction(username)] : undefined,
      };
    },
  );

  // POST /:username/chat/archive — Archive all chat messages
  fastify.post<{
    Params: AgentUsernameParams;
    Reply: ArchiveChatResponse | ErrorResponse;
  }>(
    "/:username/chat/archive",
    {
      preHandler: [requirePermission("agent_communication")],
      schema: {
        description: "Archive all chat messages for an agent",
        tags: ["Chat"],
        params: AgentUsernameParamsSchema,
        response: {
          200: ArchiveChatResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      const archivedCount = await archiveAllChatMessages(id);
      return { success: true, archivedCount };
    },
  );

  // POST /:username/chat — Send chat message
  fastify.post<{
    Params: AgentUsernameParams;
    Body: SendChatRequest;
    Reply: SendChatResponse | ErrorResponse;
  }>(
    "/:username/chat",
    {
      preHandler: [requirePermission("agent_communication")],
      schema: {
        description:
          "Send a chat message as an agent with optional attachments. Supports JSON and multipart/form-data",
        tags: ["Chat"],
        params: AgentUsernameParamsSchema,
        // No body schema — multipart requests are parsed manually via request.parts()
        response: {
          200: SendChatResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const contentType = request.headers["content-type"];
      let fromId: number = 0,
        toIds: number[] = [],
        message: string = "";
      let attachmentBuffers: Array<{ filename: string; data: Buffer }> = [];

      if (contentType?.includes("multipart/form-data")) {
        const parts = request.parts();

        for await (const part of parts) {
          if (part.type === "field") {
            const field = part as MultipartValue<string>;
            switch (field.fieldname) {
              case "fromId":
                fromId = Number(field.value);
                break;
              case "toIds":
                try {
                  toIds = JSON.parse(field.value);
                } catch {
                  return badRequest(reply, "toIds must be valid JSON array");
                }
                break;
              case "message":
                message = field.value;
                break;
            }
          } else if (part.type === "file") {
            const file = part as MultipartFile;
            if (file.fieldname === "attachments") {
              const buffer = await file.toBuffer();
              attachmentBuffers.push({
                filename: file.filename || "unnamed_file",
                data: buffer,
              });
            }
          }
        }
      } else {
        const body = request.body as SendChatRequest;
        fromId = body.fromId;
        toIds = body.toIds;
        message = body.message;
      }

      const parsed = SendChatRequestSchema.safeParse({
        fromId,
        toIds,
        message,
      });
      if (!parsed.success) {
        return badRequest(reply, parsed.error.message);
      }
      ({ fromId, toIds, message } = parsed.data);

      // Upload attachments to hub and collect IDs
      let attachmentIds: number[] | undefined;
      if (attachmentBuffers.length > 0) {
        attachmentIds = [];
        for (const att of attachmentBuffers) {
          const id = await uploadToHub(att.data, att.filename, fromId, "mail");
          attachmentIds.push(id);
        }
      }

      const result = await sendChatMessage(
        fromId,
        toIds,
        message,
        attachmentIds,
      );

      if (result.success) {
        return reply.code(200).send(result);
      } else {
        return reply.code(500).send(result);
      }
    },
  );
}
