import type {
  AgentUsernameParams,
  ContextLogParams,
  ContextLogRequest,
  ContextLogResponse,
  RunsDataRequest,
  RunsDataResponse,
} from "@naisys/supervisor-shared";
import {
  AgentUsernameParamsSchema,
  ContextLogParamsSchema,
  ContextLogRequestSchema,
  ContextLogResponseSchema,
  RunsDataRequestSchema,
  RunsDataResponseSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission } from "../auth-middleware.js";
import { notFound } from "../error-helpers.js";
import {
  API_PREFIX,
  idCursorLinks,
  timestampCursorLinks,
} from "../hateoas.js";
import { resolveAgentId } from "../services/agentService.js";
import {
  getContextLog,
  getRunsData,
  obfuscateLogs,
} from "../services/runsService.js";

export default function agentRunsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:username/runs — Runs for agent
  fastify.get<{
    Params: AgentUsernameParams;
    Querystring: RunsDataRequest;
    Reply: RunsDataResponse;
  }>(
    "/:username/runs",
    {
      schema: {
        description: "Get run sessions for a specific agent",
        tags: ["Runs"],
        params: AgentUsernameParamsSchema,
        querystring: RunsDataRequestSchema,
        response: {
          200: RunsDataResponseSchema,
          500: RunsDataResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const { updatedSince, updatedBefore, page, count } = request.query;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      const data = await getRunsData(
        { userId: id },
        updatedSince,
        updatedBefore,
        page,
        count,
      );

      const oldest = data.runs.length
        ? data.runs[data.runs.length - 1].lastActive
        : undefined;

      return {
        success: true,
        message: "Runs data retrieved successfully",
        data: data ?? undefined,
        _linkTemplates: [
          {
            rel: "logs",
            hrefTemplate: `${API_PREFIX}/agents/${username}/runs/{runId}/sessions/{sessionId}/logs`,
          },
        ],
        _links: timestampCursorLinks(
          `/agents/${username}/runs`,
          data.timestamp,
          oldest,
        ),
      };
    },
  );

  // GET /:username/runs/:runId/sessions/:sessionId/logs — Context log
  fastify.get<{
    Params: ContextLogParams;
    Querystring: ContextLogRequest;
    Reply: ContextLogResponse;
  }>(
    "/:username/runs/:runId/sessions/:sessionId/logs",
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
      const { username, runId, sessionId } = request.params;
      const { logsAfter, logsBefore, limit } = request.query;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      let data = await getContextLog(
        id,
        runId,
        sessionId,
        logsAfter,
        logsBefore,
        limit,
      );

      // Obfuscate log text for users without view_run_logs permission
      if (!hasPermission(request.supervisorUser, "view_run_logs")) {
        data = obfuscateLogs(data);
      }

      const maxLogId = data?.logs.length
        ? Math.max(...data.logs.map((l) => l.id))
        : (logsAfter ?? 0);
      const minLogId = data?.logs.length
        ? Math.min(...data.logs.map((l) => l.id))
        : undefined;

      return {
        success: true,
        message: "Context log retrieved successfully",
        data,
        _links: idCursorLinks(
          `/agents/${username}/runs/${runId}/sessions/${sessionId}/logs`,
          "logsAfter",
          "logsBefore",
          maxLogId,
          minLogId,
          limit !== undefined ? `limit=${limit}` : undefined,
        ),
      };
    },
  );
}
