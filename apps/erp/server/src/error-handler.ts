import type { ErrorResponse } from "@naisys/erp-shared";
import type { FastifyReply } from "fastify";

function send(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message: string,
): ErrorResponse {
  reply.status(statusCode);
  return { statusCode, error, message };
}

export function badRequest(
  reply: FastifyReply,
  message: string,
): ErrorResponse {
  return send(reply, 400, "Bad Request", message);
}

export function notFound(reply: FastifyReply, message: string): ErrorResponse {
  return send(reply, 404, "Not Found", message);
}

export function conflict(reply: FastifyReply, message: string): ErrorResponse {
  return send(reply, 409, "Conflict", message);
}

export function unauthorized(
  reply: FastifyReply,
  message: string,
): ErrorResponse {
  return send(reply, 401, "Unauthorized", message);
}

export function unprocessable(
  reply: FastifyReply,
  message: string,
): ErrorResponse {
  return send(reply, 422, "Unprocessable Entity", message);
}
