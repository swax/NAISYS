import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { SendMailRequest, SendMailResponse } from "shared";
import { sendMessage } from "../services/mailService.js";
import { validateSession } from "./access.js";
import { MultipartFile } from "@fastify/multipart";

export default async function mailRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.post<{ Reply: SendMailResponse }>(
    "/send-mail",
    {
      preHandler: validateSession,
    },
    async (request, reply) => {
      try {
        const contentType = request.headers['content-type'];
        let from: string = '', to: string = '', subject: string = '', message: string = '';
        let attachments: Array<{ filename: string; data: Buffer }> = [];

        if (contentType?.includes('multipart/form-data')) {
          // Handle multipart form data
          const parts = request.parts();
          
          for await (const part of parts) {
            if (part.type === 'field') {
              const field = part as any;
              switch (field.fieldname) {
                case 'from':
                  from = field.value;
                  break;
                case 'to':
                  to = field.value;
                  break;
                case 'subject':
                  subject = field.value;
                  break;
                case 'message':
                  message = field.value;
                  break;
              }
            } else if (part.type === 'file') {
              const file = part as MultipartFile;
              if (file.fieldname === 'attachments') {
                const buffer = await file.toBuffer();
                attachments.push({
                  filename: file.filename || 'unnamed_file',
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
