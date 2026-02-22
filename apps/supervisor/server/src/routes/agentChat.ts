import {
  AgentIdParams,
  AgentIdParamsSchema,
  ChatConversationsResponse,
  ChatConversationsResponseSchema,
  ChatMessagesRequest,
  ChatMessagesRequestSchema,
  ChatMessagesResponse,
  ChatMessagesResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
  SendChatRequest,
  SendChatRequestSchema,
  SendChatResponse,
  SendChatResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { API_PREFIX } from "../hateoas.js";
import {
  getConversations,
  getMessages,
  sendChatMessage,
} from "../services/chatService.js";

export default function agentChatRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:id/chat — List conversations for agent
  fastify.get<{
    Params: AgentIdParams;
    Reply: ChatConversationsResponse | ErrorResponse;
  }>(
    "/:id/chat",
    {
      schema: {
        description: "Get chat conversations for a specific agent",
        tags: ["Chat"],
        params: AgentIdParamsSchema,
        response: {
          200: ChatConversationsResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const conversations = await getConversations(id);

        const canSend = hasPermission(
          request.supervisorUser,
          "agent_communication",
        );

        return {
          success: true,
          conversations,
          _actions: canSend
            ? [
                {
                  rel: "send",
                  href: `${API_PREFIX}/agents/${id}/chat`,
                  method: "POST" as const,
                  title: "Send Chat Message",
                  schema: `${API_PREFIX}/schemas/SendChat`,
                },
              ]
            : undefined,
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:id/chat route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching chat conversations",
        });
      }
    },
  );

  // GET /:id/chat/:participantIds — Messages in a conversation
  fastify.get<{
    Params: AgentIdParams & { participantIds: string };
    Querystring: ChatMessagesRequest;
    Reply: ChatMessagesResponse | ErrorResponse;
  }>(
    "/:id/chat/:participantIds",
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
    async (request, reply) => {
      try {
        const { id, participantIds } = request.params;
        const { updatedSince, page, count } = request.query;

        // URL uses dashes as separator, DB uses commas
        const dbParticipantIds = String(participantIds).replace(/-/g, ",");

        const data = await getMessages(
          id,
          dbParticipantIds,
          updatedSince,
          page,
          count,
        );

        const canSend = hasPermission(
          request.supervisorUser,
          "agent_communication",
        );

        return {
          success: true,
          messages: data.messages,
          total: data.total,
          timestamp: data.timestamp,
          _actions: canSend
            ? [
                {
                  rel: "send",
                  href: `${API_PREFIX}/agents/${id}/chat`,
                  method: "POST" as const,
                  title: "Send Chat Message",
                  schema: `${API_PREFIX}/schemas/SendChat`,
                },
              ]
            : undefined,
        };
      } catch (error) {
        request.log.error(
          error,
          "Error in GET /agents/:id/chat/:participantIds route",
        );
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching chat messages",
        });
      }
    },
  );

  // POST /:id/chat — Send chat message
  fastify.post<{
    Params: AgentIdParams;
    Body: SendChatRequest;
    Reply: SendChatResponse | ErrorResponse;
  }>(
    "/:id/chat",
    {
      preHandler: [requirePermission("agent_communication")],
      schema: {
        description: "Send a chat message as an agent",
        tags: ["Chat"],
        params: AgentIdParamsSchema,
        body: SendChatRequestSchema,
        response: {
          200: SendChatResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const body = request.body;

        if (!body.fromId || !body.toIds?.length || !body.message) {
          return reply.code(400).send({
            success: false,
            message: "Missing required fields: fromId, toIds, message",
          });
        }

        const result = await sendChatMessage(
          body.fromId,
          body.toIds,
          body.message,
        );

        if (result.success) {
          return reply.code(200).send(result);
        } else {
          return reply.code(500).send(result);
        }
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/chat route");
        return reply.code(500).send({
          success: false,
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    },
  );
}
