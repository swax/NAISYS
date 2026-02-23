import {
  AgentIdParams,
  AgentIdParamsSchema,
  ContextLogParams,
  ContextLogParamsSchema,
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

import { API_PREFIX } from "../hateoas.js";
import { getContextLog, getRunsData } from "../services/runsService.js";

export default function agentRunsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:id/runs — Runs for agent
  fastify.get<{
    Params: AgentIdParams;
    Querystring: RunsDataRequest;
    Reply: RunsDataResponse;
  }>(
    "/:id/runs",
    {
      schema: {
        description: "Get run sessions for a specific agent",
        tags: ["Runs"],
        params: AgentIdParamsSchema,
        querystring: RunsDataRequestSchema,
        response: {
          200: RunsDataResponseSchema,
          500: RunsDataResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { updatedSince, page, count } = request.query;

        const data = await getRunsData(id, updatedSince, page, count);

        return {
          success: true,
          message: "Runs data retrieved successfully",
          data: data && {
            ...data,
            runs: data.runs.map((run) => ({
              ...run,
              _links: [
                {
                  rel: "logs",
                  href: `${API_PREFIX}/agents/${id}/runs/${run.runId}/sessions/${run.sessionId}/logs`,
                },
              ],
            })),
          },
          _links: data
            ? [
                {
                  rel: "next",
                  href: `${API_PREFIX}/agents/${id}/runs?updatedSince=${encodeURIComponent(data.timestamp)}`,
                  title: "Poll for updated runs",
                },
              ]
            : undefined,
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:id/runs route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching runs data",
        });
      }
    },
  );

  // GET /:id/runs/:runId/sessions/:sessionId/logs — Context log
  fastify.get<{
    Params: ContextLogParams;
    Querystring: ContextLogRequest;
    Reply: ContextLogResponse;
  }>(
    "/:id/runs/:runId/sessions/:sessionId/logs",
    {
      schema: {
        description: "Get context log for a specific run session",
        tags: ["Runs"],
        params: ContextLogParamsSchema,
        querystring: ContextLogRequestSchema,
        response: {
          200: ContextLogResponseSchema,
          500: ContextLogResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id, runId, sessionId } = request.params;
        const { logsAfter } = request.query;

        const data = await getContextLog(id, runId, sessionId, logsAfter);

        const maxLogId = data?.logs.length
          ? Math.max(...data.logs.map((l) => l.id))
          : (logsAfter ?? 0);

        return {
          success: true,
          message: "Context log retrieved successfully",
          data,
          _links: [
            {
              rel: "next",
              href: `${API_PREFIX}/agents/${id}/runs/${runId}/sessions/${sessionId}/logs?logsAfter=${maxLogId}`,
              title: "Poll for newer logs",
            },
          ],
        };
      } catch (error) {
        request.log.error(
          error,
          "Error in GET /agents/:id/runs/:runId/sessions/:sessionId/logs route",
        );
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching context log",
        });
      }
    },
  );
}
