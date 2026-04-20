import type { HateoasAction } from "@naisys/common";
import type {
  DeleteVariableParams,
  DeleteVariableResponse,
  ErrorResponse,
  SaveVariableRequest,
  SaveVariableResponse,
  VariablesResponse,
} from "@naisys/supervisor-shared";
import {
  DeleteVariableParamsSchema,
  DeleteVariableResponseSchema,
  ErrorResponseSchema,
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
        return reply.code(500).send({ success: false, message });
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
