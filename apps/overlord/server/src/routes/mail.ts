import { MultipartFile } from "@fastify/multipart";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  MailDataRequest,
  MailDataRequestSchema,
  MailDataResponse,
  MailDataResponseSchema,
  SendMailRequest,
  SendMailRequestSchema,
  SendMailResponse,
  SendMailResponseSchema,
} from "shared";
import { getMailData, sendMessage } from "../services/mailService.js";
import { validateSession } from "./access.js";

export default async function mailRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{
    Querystring: MailDataRequest;
    Reply: MailDataResponse;
  }>(
    "/mail",
    {
      schema: {
        description: "Get mail data for a specific agent",
        tags: ["Mail"],
        querystring: MailDataRequestSchema,
        response: {
          200: MailDataResponseSchema,
          400: MailDataResponseSchema,
          500: MailDataResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { agentName, updatedSince } = request.query;

        const data = await getMailData(agentName, updatedSince);

        return {
          success: true,
          message: "Mail data retrieved successfully",
          data,
        };
      } catch (error) {
        console.error("Error in /mail route:", error);
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching mail data",
        });
      }
    },
  );

  fastify.post<{ Reply: SendMailResponse }>(
    "/send-mail",
    {
      schema: {
        description:
          "Send email with optional attachments. Supports JSON and multipart/form-data",
        tags: ["Mail"],
        body: SendMailRequestSchema,
        response: {
          200: SendMailResponseSchema,
          400: SendMailResponseSchema,
          500: SendMailResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
      preHandler: validateSession,
    },
    async (request, reply) => {
      try {
        const contentType = request.headers["content-type"];
        let from: string = "",
          to: string = "",
          subject: string = "",
          message: string = "";
        let attachments: Array<{ filename: string; data: Buffer }> = [];

        if (contentType?.includes("multipart/form-data")) {
          // Handle multipart form data
          const parts = request.parts();

          for await (const part of parts) {
            if (part.type === "field") {
              const field = part as any;
              switch (field.fieldname) {
                case "from":
                  from = field.value;
                  break;
                case "to":
                  to = field.value;
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
          // Handle JSON request (backward compatibility)
          const body = request.body as SendMailRequest;
          from = body.from;
          to = body.to;
          subject = body.subject;
          message = body.message;
        }

        // Validate required fields
        if (!from || !to || !subject || !message) {
          return reply.code(400).send({
            success: false,
            message: "Missing required fields: from, to, subject, message",
          });
        }

        // Send the message
        const result = await sendMessage({
          from,
          to,
          subject,
          message,
          attachments: attachments.length > 0 ? attachments : undefined,
        });

        if (result.success) {
          return reply.code(200).send(result);
        } else {
          return reply.code(500).send(result);
        }
      } catch (error) {
        console.error("Error in send-mail route:", error);
        return reply.code(500).send({
          success: false,
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    },
  );
}
