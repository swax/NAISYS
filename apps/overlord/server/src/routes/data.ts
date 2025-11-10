import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  NaisysDataRequest,
  NaisysDataRequestSchema,
  NaisysDataResponse,
  NaisysDataResponseSchema,
} from "shared";
import { getNaisysData } from "../services/dataService.js";

export default async function dataRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{
    Querystring: NaisysDataRequest;
    Reply: NaisysDataResponse;
  }>(
    "/data",
    {
      schema: {
        description:
          "Get NAISYS data including agents, logs, and mail with pagination",
        tags: ["Data"],
        querystring: NaisysDataRequestSchema,
        response: {
          200: NaisysDataResponseSchema,
          400: NaisysDataResponseSchema,
          500: NaisysDataResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const data = await getNaisysData();

        return {
          success: true,
          message: "NAISYS data retrieved successfully",
          data,
        };
      } catch (error) {
        console.error("Error in /data route:", error);
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching NAISYS data",
        });
      }
    },
  );
}
