import type { HateoasAction } from "@naisys/common";
import type {
  DeleteVariableParams,
  DeleteVariableResponse,
  ErrorResponse,
  OpenAiCodexOAuthPollRequest,
  OpenAiCodexOAuthPollResponse,
  OpenAiCodexOAuthStartResponse,
  OpenAiCodexOAuthUsageResponse,
  SaveVariableRequest,
  SaveVariableResponse,
  VariablesResponse,
} from "@naisys/supervisor-shared";
import {
  DeleteVariableParamsSchema,
  DeleteVariableResponseSchema,
  ErrorResponseSchema,
  OpenAiCodexOAuthPollRequestSchema,
  OpenAiCodexOAuthPollResponseSchema,
  OpenAiCodexOAuthStartResponseSchema,
  OpenAiCodexOAuthUsageResponseSchema,
  SaveVariableRequestSchema,
  SaveVariableResponseSchema,
  VariablesResponseSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { API_PREFIX } from "../hateoas.js";
import { permGate } from "../route-helpers.js";
import { sendVariablesChanged } from "../services/hubConnectionService.js";
import {
  checkOpenAiCodexOAuthUsage,
  pollOpenAiCodexOAuthFlow,
  startOpenAiCodexOAuthFlow,
} from "../services/openAiCodexOAuthService.js";
import {
  deleteVariable,
  getVariables,
  saveVariable,
} from "../services/variableService.js";

function variableActions(hasManagePermission: boolean): HateoasAction[] {
  const gate = permGate(hasManagePermission, "manage_variables");
  return [
    {
      rel: "save",
      href: `${API_PREFIX}/variables/:key`,
      method: "PUT",
      title: "Save Variable",
      schema: `${API_PREFIX}/schemas/SaveVariable`,
      body: { value: "", exportToShell: false, sensitive: false },
      ...gate,
    },
    {
      rel: "delete",
      href: `${API_PREFIX}/variables/:key`,
      method: "DELETE",
      title: "Delete Variable",
      ...gate,
    },
  ];
}

export default function variablesRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET / — list all variables
  fastify.get<{ Reply: VariablesResponse | ErrorResponse }>(
    "/",
    {
      schema: {
        description: "List all variables",
        tags: ["Variables"],
        response: {
          200: VariablesResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, _reply) => {
      const items = await getVariables();
      const hasManagePermission = hasPermission(
        request.supervisorUser,
        "manage_variables",
      );
      const actions = variableActions(hasManagePermission);
      return {
        items: items.map((v) => ({
          key: v.key,
          value: v.sensitive && !hasManagePermission ? "" : v.value,
          exportToShell: v.export_to_shell,
          sensitive: v.sensitive,
        })),
        _actions: actions,
      };
    },
  );

  fastify.post<{ Reply: OpenAiCodexOAuthStartResponse | ErrorResponse }>(
    "/openai-codex-oauth/start",
    {
      preHandler: [requirePermission("manage_variables")],
      schema: {
        description: "Start OpenAI Codex OAuth device-code setup",
        tags: ["Variables"],
        response: {
          200: OpenAiCodexOAuthStartResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        return await startOpenAiCodexOAuthFlow();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to start OpenAI OAuth setup";
        return reply.code(500).send({ success: false, message });
      }
    },
  );

  fastify.post<{
    Body: OpenAiCodexOAuthPollRequest;
    Reply: OpenAiCodexOAuthPollResponse | ErrorResponse;
  }>(
    "/openai-codex-oauth/poll",
    {
      preHandler: [requirePermission("manage_variables")],
      schema: {
        description: "Poll OpenAI Codex OAuth device-code setup",
        tags: ["Variables"],
        body: OpenAiCodexOAuthPollRequestSchema,
        response: {
          200: OpenAiCodexOAuthPollResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await pollOpenAiCodexOAuthFlow({
          flowId: request.body.flowId,
          userUuid: request.supervisorUser!.uuid,
        });
        if (result.status === "complete") {
          sendVariablesChanged();
        }
        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to complete OpenAI OAuth setup";
        return reply.code(500).send({ success: false, message });
      }
    },
  );

  fastify.post<{ Reply: OpenAiCodexOAuthUsageResponse | ErrorResponse }>(
    "/openai-codex-oauth/usage",
    {
      preHandler: [requirePermission("manage_variables")],
      schema: {
        description: "Check OpenAI Codex OAuth usage windows",
        tags: ["Variables"],
        response: {
          200: OpenAiCodexOAuthUsageResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await checkOpenAiCodexOAuthUsage({
          userUuid: request.supervisorUser!.uuid,
        });
        if (result.refreshed) {
          sendVariablesChanged();
        }
        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to check OpenAI Codex usage";
        return reply.code(500).send({ success: false, message });
      }
    },
  );

  // PUT /:key — upsert a variable
  fastify.put<{
    Params: DeleteVariableParams;
    Body: SaveVariableRequest;
    Reply: SaveVariableResponse | ErrorResponse;
  }>(
    "/:key",
    {
      preHandler: [requirePermission("manage_variables")],
      schema: {
        description: "Create or update a variable",
        tags: ["Variables"],
        params: DeleteVariableParamsSchema,
        body: SaveVariableRequestSchema,
        response: {
          200: SaveVariableResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { key } = request.params;
        const { value, exportToShell, sensitive } = request.body;
        const result = await saveVariable(
          key,
          value,
          exportToShell,
          sensitive,
          request.supervisorUser!.uuid,
        );
        sendVariablesChanged();
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save variable";
        const status = message.includes("reserved") ? 400 : 500;
        return reply.code(status).send({ success: false, message });
      }
    },
  );

  // DELETE /:key — delete a variable
  fastify.delete<{
    Params: DeleteVariableParams;
    Reply: DeleteVariableResponse | ErrorResponse;
  }>(
    "/:key",
    {
      preHandler: [requirePermission("manage_variables")],
      schema: {
        description: "Delete a variable",
        tags: ["Variables"],
        params: DeleteVariableParamsSchema,
        response: {
          200: DeleteVariableResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { key } = request.params;
        const result = await deleteVariable(key);
        sendVariablesChanged();
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to delete variable";
        return reply.code(500).send({ success: false, message });
      }
    },
  );
}
