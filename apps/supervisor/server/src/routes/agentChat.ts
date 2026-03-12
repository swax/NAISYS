import { MultipartFile } from "@fastify/multipart";
import {
  AgentUsernameParams,
  AgentUsernameParamsSchema,
  ChatConversationsResponse,
  ChatConversationsResponseSchema,
  ChatMessagesRequest,
  ChatMessagesRequestSchema,
  ChatMessagesResponse,
  ChatMessagesResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
  SendChatRequest,
  SendChatResponse,
  SendChatResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { badRequest, notFound } from "../error-helpers.js";
import { API_PREFIX } from "../hateoas.js";
import { resolveAgentId } from "../services/agentService.js";
import { uploadToHub } from "../services/attachmentProxyService.js";
import {
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
    alternateEncoding: {
      contentType: "multipart/form-data",
      description: "Send as multipart to include file attachments",
      fileFields: ["attachments"],
    },
  };
}

export default function agentChatRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:username/chat — List conversations for agent
  fastify.get<{
    Params: AgentUsernameParams;
    Reply: ChatConversationsResponse | ErrorResponse;
  }>(
    "/:username/chat",
    {
      schema: {
        description: "Get chat conversations for a specific agent",
        tags: ["Chat"],
        params: AgentUsernameParamsSchema,
        response: {
          200: ChatConversationsResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      const conversations = await getConversations(id);

      const canSend = hasPermission(
        request.supervisorUser,
        "agent_communication",
      );

      return {
        success: true,
        conversations,
        _actions: canSend ? [sendChatAction(username)] : undefined,
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
      const { updatedSince, page, count } = request.query;

      const data = await getMessages(participants, updatedSince, page, count);

      const canSend = hasPermission(
        request.supervisorUser,
        "agent_communication",
      );

      return {
        success: true,
        messages: data.messages,
        total: data.total,
        timestamp: data.timestamp,
        _actions: canSend ? [sendChatAction(username)] : undefined,
      };
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
            const field = part as any;
            switch (field.fieldname) {
              case "fromId":
                fromId = Number(field.value);
                break;
              case "toIds":
                toIds = JSON.parse(field.value);
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

      if (!fromId || !toIds?.length || !message) {
        return badRequest(
          reply,
          "Missing required fields: fromId, toIds, message",
        );
      }

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
