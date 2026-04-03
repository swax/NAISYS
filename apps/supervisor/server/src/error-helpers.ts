import type { ErrorResponse } from "@naisys/supervisor-shared";
import type { FastifyReply } from "fastify";

export function notFound(reply: FastifyReply, message: string): ErrorResponse {
  reply.status(404);
  return { success: false, message };
}

export function badRequest(
  reply: FastifyReply,
  message: string,
): ErrorResponse {
  reply.status(400);
  return { success: false, message };
}

export function conflict(reply: FastifyReply, message: string): ErrorResponse {
  reply.status(409);
  return { success: false, message };
}
