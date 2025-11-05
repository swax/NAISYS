import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  NaisysDataRequest,
  NaisysDataRequestSchema,
  NaisysDataResponse,
  NaisysDataResponseSchema,
  ReadStatusUpdateRequest,
  ReadStatusUpdateRequestSchema,
  ReadStatusUpdateResponseSchema,
} from "shared";
import { getNaisysData } from "../services/dataService.js";
import {
  updateLastReadLogId,
  updateLastReadMailId,
} from "../services/readService.js";
import { validateSession } from "./access.js";

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
      const { logsAfter, logsLimit, mailAfter, mailLimit } = request.query;

      const logsAfterId = logsAfter ? parseInt(logsAfter, 10) : undefined;
      const logsLimitNum = logsLimit ? parseInt(logsLimit, 10) : 10000;
      const mailAfterId = mailAfter ? parseInt(mailAfter, 10) : undefined;
      const mailLimitNum = mailLimit ? parseInt(mailLimit, 10) : 1000;

      if (logsAfter && isNaN(logsAfterId!)) {
        return reply.status(400).send({
          success: false,
          message: "Invalid 'logsAfter' parameter. Must be a number.",
        });
      }

      if (
        logsLimit &&
        (isNaN(logsLimitNum) || logsLimitNum <= 0 || logsLimitNum > 10000)
      ) {
        return reply.status(400).send({
          success: false,
          message:
            "Invalid 'logsLimit' parameter. Must be a number between 1 and 10000.",
        });
      }

      if (mailAfter && isNaN(mailAfterId!)) {
        return reply.status(400).send({
          success: false,
          message: "Invalid 'mailAfter' parameter. Must be a number.",
        });
      }

      if (
        mailLimit &&
        (isNaN(mailLimitNum) || mailLimitNum <= 0 || mailLimitNum > 10000)
      ) {
        return reply.status(400).send({
          success: false,
          message:
            "Invalid 'mailLimit' parameter. Must be a number between 1 and 10000.",
        });
      }

      const data = await getNaisysData(
        logsAfterId,
        logsLimitNum,
        mailAfterId,
        mailLimitNum,
      );

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
  });

  // Update read status endpoint
  fastify.post<{
    Body: ReadStatusUpdateRequest;
  }>(
    "/read-status",
    {
      schema: {
        description: "Update read status for an agent's logs and mail",
        tags: ["Data"],
        body: ReadStatusUpdateRequestSchema,
        response: {
          200: ReadStatusUpdateResponseSchema,
          500: ReadStatusUpdateResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
      preHandler: validateSession,
    },
    async (request, reply) => {
      try {
        const { agentName, lastReadLogId, lastReadMailId } = request.body;

        if (lastReadLogId !== undefined) {
          await updateLastReadLogId(agentName, lastReadLogId);
        }
        if (lastReadMailId !== undefined) {
          await updateLastReadMailId(agentName, lastReadMailId);
        }

        return {
          success: true,
          message: "Read status updated successfully",
        };
      } catch (error) {
        console.error("Error updating read status:", error);
        return reply.status(500).send({
          success: false,
          message: "Internal server error while updating read status",
        });
      }
    },
  );
}
