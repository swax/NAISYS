import type { FastifyInstance, FastifyReply } from "fastify";
import type { ErrorResponse } from "@naisys-erp/shared";

export function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler(
    (
      error: Error & {
        validation?: unknown;
        statusCode?: number;
        code?: string;
      },
      _request,
      reply,
    ) => {
      // Zod validation errors (thrown by fastify-type-provider-zod)
      if (error.validation) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: error.message,
        } satisfies ErrorResponse);
      }

      // Prisma unique constraint violation
      if (
        error.name === "PrismaClientKnownRequestError" &&
        error.code === "P2002"
      ) {
        return reply.status(409).send({
          statusCode: 409,
          error: "Conflict",
          message: "A record with that unique value already exists",
        } satisfies ErrorResponse);
      }

      // Unhandled errors
      fastify.log.error(error);
      const statusCode =
        error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
      return reply.status(statusCode).send({
        statusCode,
        error: statusCode >= 500 ? "Internal Server Error" : "Error",
        message:
          statusCode >= 500 ? "An unexpected error occurred" : error.message,
      } satisfies ErrorResponse);
    },
  );
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message: string,
): ErrorResponse {
  reply.status(statusCode);
  return { statusCode, error, message };
}
