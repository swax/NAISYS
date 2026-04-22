import type {
  AgentRunCommandRequestBody,
  AgentRunCommandResult,
  AgentRunPauseResult,
  AgentUsernameParams,
  ContextLogParams,
  ContextLogRequest,
  ContextLogResponse,
  ErrorResponse,
  RunsDataRequest,
  RunsDataResponse,
} from "@naisys/supervisor-shared";
import {
  AgentRunCommandRequestSchema,
  AgentRunCommandResultSchema,
  AgentRunPauseResultSchema,
  AgentUsernameParamsSchema,
  ContextLogParamsSchema,
  ContextLogRequestSchema,
  ContextLogResponseSchema,
  ErrorResponseSchema,
  RunsDataRequestSchema,
  RunsDataResponseSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { notFound } from "../error-helpers.js";
import { API_PREFIX, idCursorLinks, timestampCursorLinks } from "../hateoas.js";
import { resolveAgentId } from "../services/agentService.js";
import {
  isHubConnected,
  sendAgentRunCommand,
  sendAgentRunPauseState,
} from "../services/hubConnectionService.js";
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

  // Paired pause/resume routes — the verb is carried in the URL rather than
  // the body so the HATEOAS action list can express them as two distinct
  // affordances that toggle on/off based on current run state.
  registerRunPauseRoute(fastify, "pause", true);
  registerRunPauseRoute(fastify, "resume", false);

  fastify.post<{
    Params: ContextLogParams;
    Body: AgentRunCommandRequestBody;
    Reply: AgentRunCommandResult | ErrorResponse;
  }>(
    "/:username/runs/:runId/sessions/:sessionId/command",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Send a command to a run's active session via the hub",
        tags: ["Runs"],
        params: ContextLogParamsSchema,
        body: AgentRunCommandRequestSchema,
        response: {
          200: AgentRunCommandResultSchema,
          503: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username, runId, sessionId } = request.params;
      const { command } = request.body;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      if (!isHubConnected()) {
        return reply.status(503).send({
          success: false,
          message: "Hub is not connected",
        });
      }

      const response = await sendAgentRunCommand(id, runId, sessionId, command);

      if (response.success) {
        return {
          success: true,
          message: "Command sent",
        };
      } else {
        return reply.status(500).send({
          success: false,
          message: response.error || "Failed to send command",
        });
      }
    },
  );
}

function registerRunPauseRoute(
  fastify: FastifyInstance,
  verb: "pause" | "resume",
  paused: boolean,
) {
  const label = verb === "pause" ? "Pause" : "Resume";

  fastify.post<{
    Params: ContextLogParams;
    Reply: AgentRunPauseResult | ErrorResponse;
  }>(
    `/:username/runs/:runId/sessions/:sessionId/${verb}`,
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: `${label} a run's active session via the hub`,
        tags: ["Runs"],
        params: ContextLogParamsSchema,
        response: {
          200: AgentRunPauseResultSchema,
          503: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username, runId, sessionId } = request.params;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      if (!isHubConnected()) {
        return reply.status(503).send({
          success: false,
          message: "Hub is not connected",
        });
      }

      const response = await sendAgentRunPauseState(
        id,
        runId,
        sessionId,
        paused,
      );

      if (response.success) {
        return {
          success: true,
          message: paused ? "Run paused" : "Run resumed",
        };
      } else {
        return reply.status(500).send({
          success: false,
          message: response.error || `Failed to ${verb} run`,
        });
      }
    },
  );
}
