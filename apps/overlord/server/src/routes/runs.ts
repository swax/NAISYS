import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  RunsDataRequest,
  RunsDataRequestSchema,
  RunsDataResponse,
  RunsDataResponseSchema,
} from "shared";
import { getRunsData } from "../services/runsService.js";

export default async function runsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{
    Querystring: RunsDataRequest;
    Reply: RunsDataResponse;
  }>(
    "/runs",
    {
      schema: {
        description: "Get run sessions for a specific user",
        tags: ["Runs"],
        querystring: RunsDataRequestSchema,
        response: {
          200: RunsDataResponseSchema,
          400: RunsDataResponseSchema,
          500: RunsDataResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { userId: userIdStr, updatedSince } = request.query;

        const userId = parseInt(userIdStr, 10);

        if (!userIdStr || isNaN(userId)) {
          return reply.status(400).send({
            success: false,
            message: "Invalid 'userId' parameter. Must be a number.",
          });
        }

        const data = await getRunsData(userId, updatedSince);

        return {
          success: true,
          message: "Runs data retrieved successfully",
          data,
        };
      } catch (error) {
        console.error("Error in /runs route:", error);
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching runs data",
        });
      }
    },
  );
}
