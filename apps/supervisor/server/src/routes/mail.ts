import { MultipartFile } from "@fastify/multipart";
import {
  ErrorResponseSchema,
  SendMailRequest,
  SendMailRequestSchema,
  SendMailResponse,
  SendMailResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { requirePermission } from "../auth-middleware.js";
import { sendMessage } from "../services/mailService.js";

export default function mailRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.post<{ Reply: SendMailResponse }>(
    "/send-mail",
    {
      preHandler: [requirePermission("agent_communication")],
      schema: {
        description:
          "Send email with optional attachments. Supports JSON and multipart/form-data",
        tags: ["Mail"],
        body: SendMailRequestSchema,
        response: {
          200: SendMailResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const contentType = request.headers["content-type"];
        let fromId: number = 0,
          toId: number = 0,
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
                case "fromId":
                  fromId = Number(field.value);
                  break;
                case "toId":
                  toId = Number(field.value);
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
          // Handle JSON request
          const body = request.body as SendMailRequest;
          fromId = body.fromId;
          toId = body.toId;
          subject = body.subject;
          message = body.message;
        }

        // Validate required fields
        if (!fromId || !toId || !subject || !message) {
          return reply.code(400).send({
            success: false,
            message: "Missing required fields: fromId, toId, subject, message",
          });
        }

        // Send the message
        const result = await sendMessage({
          fromId,
          toId,
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
        request.log.error(error, "Error in send-mail route");
        return reply.code(500).send({
          success: false,
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    },
  );
}
