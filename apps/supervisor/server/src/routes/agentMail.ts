import { MultipartFile } from "@fastify/multipart";
import {
  AgentUsernameParams,
  AgentUsernameParamsSchema,
  ArchiveMailResponse,
  ArchiveMailResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
  MailDataRequest,
  MailDataRequestSchema,
  MailDataResponse,
  MailDataResponseSchema,
  SendMailRequest,
  SendMailResponse,
  SendMailResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { badRequest, notFound } from "../error-helpers.js";
import { API_PREFIX } from "../hateoas.js";
import { resolveAgentId } from "../services/agentService.js";
import {
  archiveAllMailMessages,
  getMailDataByUserId,
  sendMessage,
} from "../services/mailService.js";

export default function agentMailRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:username/mail — Mail for agent
  fastify.get<{
    Params: AgentUsernameParams;
    Querystring: MailDataRequest;
    Reply: MailDataResponse;
  }>(
    "/:username/mail",
    {
      schema: {
        description: "Get mail data for a specific agent",
        tags: ["Mail"],
        params: AgentUsernameParamsSchema,
        querystring: MailDataRequestSchema,
        response: {
          200: MailDataResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const { updatedSince, page, count } = request.query;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      const data = await getMailDataByUserId(
        id,
        updatedSince,
        page,
        count,
        "mail",
      );

      const canSend = hasPermission(
        request.supervisorUser,
        "agent_communication",
      );

      return {
        success: true,
        message: "Mail data retrieved successfully",
        data,
        _links: data
          ? [
              {
                rel: "next",
                href: `${API_PREFIX}/agents/${username}/mail?updatedSince=${encodeURIComponent(data.timestamp)}`,
                title: "Poll for newer mail",
              },
            ]
          : undefined,
        _actions: canSend
          ? [
              {
                rel: "send",
                href: `${API_PREFIX}/agents/${username}/mail`,
                method: "POST" as const,
                title: "Send Mail",
                schema: `${API_PREFIX}/schemas/SendMail`,
                body: { fromId: 0, toIds: [0], subject: "", message: "" },
                alternateEncoding: {
                  contentType: "multipart/form-data",
                  description: "Send as multipart to include file attachments",
                  fileFields: ["attachments"],
                },
              },
              {
                rel: "archive",
                href: `${API_PREFIX}/agents/${username}/mail/archive`,
                method: "POST" as const,
                title: "Archive All Mail Messages",
              },
            ]
          : undefined,
      };
    },
  );

  // POST /:username/mail/archive — Archive all mail messages
  fastify.post<{
    Params: AgentUsernameParams;
    Reply: ArchiveMailResponse | ErrorResponse;
  }>(
    "/:username/mail/archive",
    {
      preHandler: [requirePermission("agent_communication")],
      schema: {
        description: "Archive all mail messages for an agent",
        tags: ["Mail"],
        params: AgentUsernameParamsSchema,
        response: {
          200: ArchiveMailResponseSchema,
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

      const archivedCount = await archiveAllMailMessages(id);
      return { success: true, archivedCount };
    },
  );

  // POST /:username/mail — Send mail as agent
  fastify.post<{
    Params: AgentUsernameParams;
    Reply: SendMailResponse;
  }>(
    "/:username/mail",
    {
      preHandler: [requirePermission("agent_communication")],
      schema: {
        description:
          "Send email as agent with optional attachments. Supports JSON and multipart/form-data",
        tags: ["Mail"],
        params: AgentUsernameParamsSchema,
        // No body schema — multipart requests are parsed manually via request.parts()
        response: {
          200: SendMailResponseSchema,
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
        subject: string = "",
        message: string = "";
      let attachments: Array<{ filename: string; data: Buffer }> = [];

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
                toIds = JSON.parse(field.value as string);
                break;
              case "subject":
                subject = field.value;
                break;
              case "message":
                message = field.value;
                break;
            }
          } else if (part.type === "file") {
            const file = part as MultipartFile;
            if (file.fieldname === "attachments") {
              const buffer = await file.toBuffer();
              attachments.push({
                filename: file.filename || "unnamed_file",
                data: buffer,
              });
            }
          }
        }
      } else {
        const body = request.body as SendMailRequest;
        fromId = body.fromId;
        toIds = body.toIds;
        subject = body.subject;
        message = body.message;
      }

      if (!fromId || toIds.length === 0 || !subject || !message) {
        return badRequest(
          reply,
          "Missing required fields: fromId, toIds, subject, message",
        );
      }

      const result = await sendMessage(
        { fromId, toIds, subject, message },
        attachments.length > 0 ? attachments : undefined,
      );

      if (result.success) {
        return reply.code(200).send(result);
      } else {
        return reply.code(500).send(result);
      }
    },
  );
}
