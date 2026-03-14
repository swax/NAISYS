import {
  CostsHistogramRequest,
  CostsHistogramRequestSchema,
  CostsHistogramResponse,
  CostsHistogramResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

import {
  findUserIdsForLead,
  getCostHistogram,
  getCostsByAgent,
  getSpendLimitSettings,
} from "../services/costsService.js";

export default function costsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{
    Querystring: CostsHistogramRequest;
    Reply: CostsHistogramResponse | ErrorResponse;
  }>(
    "/",
    {
      schema: {
        description: "Get cost histogram data",
        tags: ["Costs"],
        querystring: CostsHistogramRequestSchema,
        response: {
          200: CostsHistogramResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { spendLimitDollars, spendLimitHours } =
          await getSpendLimitSettings();

        const now = new Date();
        const defaultStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const start = request.query.start
          ? new Date(request.query.start)
          : defaultStart;
        const end = request.query.end ? new Date(request.query.end) : now;
        const bucketHours = request.query.bucketHours ?? 24;

        if (
          isNaN(start.getTime()) ||
          isNaN(end.getTime()) ||
          bucketHours <= 0
        ) {
          return reply
            .code(400)
            .send({ success: false, message: "Invalid query parameters" });
        }

        const userIds = request.query.leadUsername
          ? await findUserIdsForLead(request.query.leadUsername)
          : undefined;

        const [buckets, byAgent] = await Promise.all([
          getCostHistogram(start, end, bucketHours, userIds),
          getCostsByAgent(start, end, userIds),
        ]);

        return {
          spendLimitDollars,
          spendLimitHours,
          buckets,
          byAgent,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to fetch costs";
        return reply.code(500).send({ success: false, message });
      }
    },
  );
}
