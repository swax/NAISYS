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
  SubagentSessionParams,
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
  SubagentSessionParamsSchema,
} from "@naisys/supervisor-shared";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
} from "fastify";

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
          {
            rel: "subagent-logs",
            hrefTemplate: `${API_PREFIX}/agents/${username}/runs/{runId}/subagents/{subagentId}/sessions/{sessionId}/logs`,
          },
          {
            rel: "pause",
            hrefTemplate: `${API_PREFIX}/agents/${username}/runs/{runId}/sessions/{sessionId}/pause`,
          },
          {
            rel: "subagent-pause",
            hrefTemplate: `${API_PREFIX}/agents/${username}/runs/{runId}/subagents/{subagentId}/sessions/{sessionId}/pause`,
          },
          {
            rel: "resume",
            hrefTemplate: `${API_PREFIX}/agents/${username}/runs/{runId}/sessions/{sessionId}/resume`,
          },
          {
            rel: "subagent-resume",
            hrefTemplate: `${API_PREFIX}/agents/${username}/runs/{runId}/subagents/{subagentId}/sessions/{sessionId}/resume`,
          },
          {
            rel: "command",
            hrefTemplate: `${API_PREFIX}/agents/${username}/runs/{runId}/sessions/{sessionId}/command`,
          },
          {
            rel: "subagent-command",
            hrefTemplate: `${API_PREFIX}/agents/${username}/runs/{runId}/subagents/{subagentId}/sessions/{sessionId}/command`,
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

  // Context log — parent and subagent variants share a handler.
  registerContextLogRoute(fastify, false);
  registerContextLogRoute(fastify, true);

  // Paired pause/resume routes — the verb is carried in the URL rather than
  // the body so the HATEOAS action list can express them as two distinct
  // affordances that toggle on/off based on current run state.
  registerRunPauseRoute(fastify, "pause", true, false);
  registerRunPauseRoute(fastify, "pause", true, true);
  registerRunPauseRoute(fastify, "resume", false, false);
  registerRunPauseRoute(fastify, "resume", false, true);

  registerRunCommandRoute(fastify, false);
  registerRunCommandRoute(fastify, true);
}

function registerContextLogRoute(
  fastify: FastifyInstance,
  withSubagent: boolean,
) {
  const path = withSubagent
    ? "/:username/runs/:runId/subagents/:subagentId/sessions/:sessionId/logs"
    : "/:username/runs/:runId/sessions/:sessionId/logs";
  const params = withSubagent
    ? SubagentSessionParamsSchema
    : ContextLogParamsSchema;

  fastify.get<{
    Params: ContextLogParams | SubagentSessionParams;
    Querystring: ContextLogRequest;
    Reply: ContextLogResponse;
  }>(
    path,
    {
      schema: {
        description: withSubagent
          ? "Get context log for a subagent's run session"
          : "Get context log for a specific run session",
        tags: ["Runs"],
        params,
        querystring: ContextLogRequestSchema,
        response: {
          200: ContextLogResponseSchema,
          500: ContextLogResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { username, runId, sessionId } = request.params;
      const subagentId = withSubagent
        ? (request.params as SubagentSessionParams).subagentId
        : undefined;
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
        subagentId,
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

      const baseHref = withSubagent
        ? `/agents/${username}/runs/${runId}/subagents/${subagentId}/sessions/${sessionId}/logs`
        : `/agents/${username}/runs/${runId}/sessions/${sessionId}/logs`;

      return {
        success: true,
        message: "Context log retrieved successfully",
        data,
        _links: idCursorLinks(
          baseHref,
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

function registerRunPauseRoute(
  fastify: FastifyInstance,
  verb: "pause" | "resume",
  paused: boolean,
  withSubagent: boolean,
) {
  const label = verb === "pause" ? "Pause" : "Resume";
  const path = withSubagent
    ? `/:username/runs/:runId/subagents/:subagentId/sessions/:sessionId/${verb}`
    : `/:username/runs/:runId/sessions/:sessionId/${verb}`;
  const params = withSubagent
    ? SubagentSessionParamsSchema
    : ContextLogParamsSchema;

  fastify.post<{
    Params: ContextLogParams | SubagentSessionParams;
    Reply: AgentRunPauseResult | ErrorResponse;
  }>(
    path,
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: withSubagent
          ? `${label} a subagent's active session via the hub`
          : `${label} a run's active session via the hub`,
        tags: ["Runs"],
        params,
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
      const subagentId = withSubagent
        ? (request.params as SubagentSessionParams).subagentId
        : undefined;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      if (!isHubConnected()) {
        return hubUnavailable(reply);
      }

      const response = await sendAgentRunPauseState(
        id,
        runId,
        sessionId,
        paused,
        subagentId,
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

function registerRunCommandRoute(
  fastify: FastifyInstance,
  withSubagent: boolean,
) {
  const path = withSubagent
    ? "/:username/runs/:runId/subagents/:subagentId/sessions/:sessionId/command"
    : "/:username/runs/:runId/sessions/:sessionId/command";
  const params = withSubagent
    ? SubagentSessionParamsSchema
    : ContextLogParamsSchema;

  fastify.post<{
    Params: ContextLogParams | SubagentSessionParams;
    Body: AgentRunCommandRequestBody;
    Reply: AgentRunCommandResult | ErrorResponse;
  }>(
    path,
    {
      preHandler: [requirePermission("remote_execution")],
      schema: {
        description: withSubagent
          ? "Send a command to a subagent's active session via the hub"
          : "Send a command to a run's active session via the hub",
        tags: ["Runs"],
        params,
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
      const subagentId = withSubagent
        ? (request.params as SubagentSessionParams).subagentId
        : undefined;
      const { command } = request.body;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      if (!isHubConnected()) {
        return hubUnavailable(reply);
      }

      const response = await sendAgentRunCommand(
        id,
        runId,
        sessionId,
        command,
        subagentId,
      );

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

function hubUnavailable(reply: FastifyReply) {
  return reply.status(503).send({
    success: false,
    message: "Hub is not connected",
  });
}
