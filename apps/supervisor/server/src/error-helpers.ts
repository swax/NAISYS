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

export function unauthorized(
  reply: FastifyReply,
  message: string,
): ErrorResponse {
  reply.status(401);
  return { success: false, message };
}

export function forbidden(reply: FastifyReply, message: string): ErrorResponse {
  reply.status(403);
  return { success: false, message };
}

/**
 * Send-and-end variants for use inside preHandlers, where we can't return the
 * payload to Fastify's reply pipeline — the request lifecycle ends here.
 */
export function sendUnauthorized(reply: FastifyReply, message: string): void {
  reply.status(401).send({ success: false, message });
}

export function sendForbidden(reply: FastifyReply, message: string): void {
  reply.status(403).send({ success: false, message });
}
