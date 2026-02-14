import {
  ErrorResponseSchema,
  StatusResponse,
  StatusResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  getAgentStatusSnapshot,
  isHubConnected,
  onAgentStatusUpdate,
} from "../services/hubConnectionService.js";

export default async function statusRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{ Reply: StatusResponse }>(
    "/status",
    {
      schema: {
        description: "Get server status including hub connection",
        tags: ["Status"],
        response: {
          200: StatusResponseSchema,
          401: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async () => {
      return {
        hubConnected: isHubConnected(),
      };
    },
  );

  fastify.get(
    "/status/stream",
    { schema: { hide: true } },
    async (request, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Send initial snapshot
      const snapshot = getAgentStatusSnapshot();
      reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);

      // Subscribe to updates
      const unsubscribe = onAgentStatusUpdate((event) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // 30s keepalive to prevent proxy timeouts
      const keepalive = setInterval(() => {
        reply.raw.write(": keepalive\n\n");
      }, 30_000);

      // Cleanup on client disconnect
      request.raw.on("close", () => {
        unsubscribe();
        clearInterval(keepalive);
      });
    },
  );
}
