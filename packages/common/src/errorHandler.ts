/**
 * Shared Fastify error handler that bypasses route-level Zod response
 * serializers by sending a pre-stringified JSON payload.  Without this,
 * an error whose shape doesn't match the route's response schema causes a
 * cascading "Failed to serialize an error" from fastify-type-provider-zod.
 *
 * Interfaces are duck-typed so @naisys/common doesn't need a Fastify dependency.
 */

interface HandlerError {
  statusCode?: number;
  message: string;
  name?: string;
  code?: string;
}

interface HandlerRequest {
  url: string;
  method: string;
  log: { error: (obj: Record<string, unknown>, msg: string) => void };
}

interface HandlerReply {
  status: (code: number) => HandlerReply;
  header: (key: string, value: string) => HandlerReply;
  send: (payload: string) => void;
}

function errorLabel(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    default:
      return statusCode >= 500 ? "Internal Server Error" : "Error";
  }
}

export function commonErrorHandler(
  error: HandlerError,
  request: HandlerRequest,
  reply: HandlerReply,
): void {
  let statusCode = error.statusCode ?? 500;
  let message = error.message;

  // Prisma unique-constraint violation → 409 Conflict
  if (
    error.name === "PrismaClientKnownRequestError" &&
    error.code === "P2002"
  ) {
    statusCode = 409;
    message = "A record with that unique value already exists";
  }

  request.log.error(
    { err: error, url: request.url, method: request.method },
    "Request error",
  );

  // Pre-stringify to bypass the route's Zod response serializer
  reply
    .status(statusCode)
    .header("content-type", "application/json; charset=utf-8")
    .send(
      JSON.stringify({
        statusCode,
        error: errorLabel(statusCode),
        message,
      }),
    );
}
