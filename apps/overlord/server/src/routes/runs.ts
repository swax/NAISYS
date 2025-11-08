import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  ContextLogRequest,
  ContextLogRequestSchema,
  ContextLogResponse,
  ContextLogResponseSchema,
  RunsDataRequest,
  RunsDataRequestSchema,
  RunsDataResponse,
  RunsDataResponseSchema,
} from "shared";
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
        const {
          userId: userIdStr,
          runId: runIdStr,
          sessionId: sessionIdStr,
          logsAfter: logsAfterStr,
        } = request.query;

        const userId = parseInt(userIdStr, 10);
        const runId = parseInt(runIdStr, 10);
        const sessionId = parseInt(sessionIdStr, 10);
        const logsAfter = logsAfterStr ? parseInt(logsAfterStr, 10) : undefined;

        if (!userIdStr || isNaN(userId)) {
          return reply.status(400).send({
            success: false,
            message: "Invalid 'userId' parameter. Must be a number.",
          });
        }

        if (!runIdStr || isNaN(runId)) {
          return reply.status(400).send({
            success: false,
            message: "Invalid 'runId' parameter. Must be a number.",
          });
        }

        if (!sessionIdStr || isNaN(sessionId)) {
          return reply.status(400).send({
            success: false,
            message: "Invalid 'sessionId' parameter. Must be a number.",
          });
        }

        if (logsAfterStr && isNaN(logsAfter!)) {
          return reply.status(400).send({
            success: false,
            message: "Invalid 'logsAfter' parameter. Must be a number.",
          });
        }

        const data = await getContextLog(userId, runId, sessionId, logsAfter);

        return {
          success: true,
          message: "Context log retrieved successfully",
          data,
        };
      } catch (error) {
        console.error("Error in /context-log route:", error);
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching context log",
        });
      }
    },
  );
}
