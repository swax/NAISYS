import {
  ErrorResponseSchema,
  StatusResponse,
  StatusResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

import { isHubConnected } from "../services/hubConnectionService.js";

export default function statusRoutes(
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
    () => {
      return {
        hubConnected: isHubConnected(),
      };
    },
  );
}
