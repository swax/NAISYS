import type { FastifyReply } from "fastify";
import type { ErrorResponse } from "@naisys-erp/shared";

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message: string,
): ErrorResponse {
  reply.status(statusCode);
  return { statusCode, error, message };
}
