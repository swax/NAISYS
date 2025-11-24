import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  ErrorResponseSchema,
  NaisysDataRequest,
  NaisysDataRequestSchema,
  NaisysDataResponse,
  NaisysDataResponseSchema,
} from "shared";
import { getAgentData } from "../services/agentService.js";

export default async function agentRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{
    Querystring: NaisysDataRequest;
    Reply: NaisysDataResponse;
  }>(
    "/agent",
    {
      schema: {
        description: "Get agent data including agent status and metadata",
        tags: ["Agent"],
        querystring: NaisysDataRequestSchema,
        response: {
          200: NaisysDataResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { updatedSince } = request.query;
        const data = await getAgentData(updatedSince);

        return {
          success: true,
          message: "Agent data retrieved successfully",
          data,
        };
      } catch (error) {
        console.error("Error in /agent route:", error);
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agent data",
        });
      }
    },
  );
}
