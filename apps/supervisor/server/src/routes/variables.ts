import type { HateoasAction } from "@naisys/common";
import {
  DeleteVariableParams,
  DeleteVariableParamsSchema,
  DeleteVariableResponse,
  DeleteVariableResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
  SaveVariableRequest,
  SaveVariableRequestSchema,
  SaveVariableResponse,
  SaveVariableResponseSchema,
  VariablesResponse,
  VariablesResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { requirePermission } from "../auth-middleware.js";
import { API_PREFIX } from "../hateoas.js";
import { sendVariablesChanged } from "../services/hubConnectionService.js";
import {
  getVariables,
  saveVariable,
  deleteVariable,
} from "../services/variableService.js";

function variableActions(hasManagePermission: boolean): HateoasAction[] {
  const actions: HateoasAction[] = [];
  if (hasManagePermission) {
    actions.push(
      {
        rel: "save",
        href: `${API_PREFIX}/variables/:key`,
        method: "PUT",
        title: "Save Variable",
        schema: `${API_PREFIX}/schemas/SaveVariable`,
      },
      {
        rel: "delete",
        href: `${API_PREFIX}/variables/:key`,
        method: "DELETE",
        title: "Delete Variable",
      },
    );
  }
  return actions;
}

export default async function variablesRoutes(
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
    async (request, reply) => {
      try {
        const items = await getVariables();
        const hasManagePermission =
          request.supervisorUser?.permissions.includes("manage_variables") ??
          false;
        const actions = variableActions(hasManagePermission);
        return {
          items: items.map((v) => ({ key: v.key, value: v.value })),
          _actions: actions.length > 0 ? actions : undefined,
        };
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message: "Error loading variables",
        });
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
        const { value } = request.body;
        const result = await saveVariable(
          key,
          value,
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
