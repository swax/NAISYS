import {
  ContextLogRequest,
  ContextLogRequestSchema,
  ContextLogResponse,
  ContextLogResponseSchema,
  RunsDataRequest,
  RunsDataRequestSchema,
  RunsDataResponse,
  RunsDataResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { getContextLog, getRunsData } from "../services/runsService.js";

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
        const { userId, updatedSince, page, count } = request.query;

        const data = await getRunsData(userId, updatedSince, page, count);

        return {
          success: true,
          message: "Runs data retrieved successfully",
          data,
        };
      } catch (error) {
        request.log.error(error, "Error in /runs route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching runs data",
        });
      }
    },
  );

  fastify.get<{
    Querystring: ContextLogRequest;
    Reply: ContextLogResponse;
  }>(
    "/context-log",
    {
      schema: {
        description: "Get context log for a specific run session",
        tags: ["Runs"],
        querystring: ContextLogRequestSchema,
        response: {
          200: ContextLogResponseSchema,
          400: ContextLogResponseSchema,
          500: ContextLogResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { userId, runId, sessionId, logsAfter } = request.query;

        const data = await getContextLog(userId, runId, sessionId, logsAfter);

        return {
          success: true,
          message: "Context log retrieved successfully",
          data,
        };
      } catch (error) {
        request.log.error(error, "Error in /context-log route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching context log",
        });
      }
    },
  );
}
