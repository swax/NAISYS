import {
  getAllImageModelOptions,
  getAllLlmModelOptions,
  getValidModelKeys,
} from "@naisys/common";
import { loadCustomModels } from "@naisys/common/dist/customModelsLoader.js";
import {
  AgentIdParams,
  AgentIdParamsSchema,
  ErrorResponse,
  ErrorResponseSchema,
  GetAgentConfigResponse,
  GetAgentConfigResponseSchema,
  UpdateAgentConfigRequest,
  UpdateAgentConfigRequestSchema,
  UpdateAgentConfigResponse,
  UpdateAgentConfigResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { API_PREFIX } from "../hateoas.js";
import {
  getAgentConfigById,
  updateAgentConfigById,
} from "../services/agentConfigService.js";

export default async function agentConfigRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:id/config — Get parsed agent config
  fastify.get<{
    Params: AgentIdParams;
    Reply: GetAgentConfigResponse | ErrorResponse;
  }>(
    "/:id/config",
    {
      schema: {
        description: "Get parsed agent configuration",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: GetAgentConfigResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const config = await getAgentConfigById(id);

        const canManage = hasPermission(request.supervisorUser, "manage_agents");
        return {
          config,
          _actions: canManage
            ? [
                {
                  rel: "update",
                  href: `${API_PREFIX}/agents/${id}/config`,
                  method: "PUT" as const,
                  title: "Update Config",
                },
              ]
            : undefined,
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:id/config route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return reply.status(404).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agent configuration",
        });
      }
    },
  );

  // PUT /:id/config — Update agent config
  fastify.put<{
    Params: AgentIdParams;
    Body: UpdateAgentConfigRequest;
    Reply: UpdateAgentConfigResponse;
  }>(
    "/:id/config",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Update agent configuration",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        body: UpdateAgentConfigRequestSchema,
        response: {
          200: UpdateAgentConfigResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { config } = request.body;

        // Validate model keys against known models (skip template variables)
        const isTemplateVar = (v: string) => /^\$\{.+\}$/.test(v);

        const custom = loadCustomModels();
        const validLlmKeys = getValidModelKeys(
          getAllLlmModelOptions(custom.llmModels),
        );
        const validImageKeys = getValidModelKeys(
          getAllImageModelOptions(custom.imageModels),
        );

        const invalidModels: string[] = [];
        if (
          !isTemplateVar(config.shellModel) &&
          !validLlmKeys.has(config.shellModel)
        ) {
          invalidModels.push(`shellModel: "${config.shellModel}"`);
        }
        if (
          config.webModel &&
          !isTemplateVar(config.webModel) &&
          !validLlmKeys.has(config.webModel)
        ) {
          invalidModels.push(`webModel: "${config.webModel}"`);
        }
        if (
          config.compactModel &&
          !isTemplateVar(config.compactModel) &&
          !validLlmKeys.has(config.compactModel)
        ) {
          invalidModels.push(`compactModel: "${config.compactModel}"`);
        }
        if (
          config.imageModel &&
          !isTemplateVar(config.imageModel) &&
          !validImageKeys.has(config.imageModel)
        ) {
          invalidModels.push(`imageModel: "${config.imageModel}"`);
        }

        if (invalidModels.length > 0) {
          return reply.status(400).send({
            success: false,
            message: `Invalid model key(s): ${invalidModels.join(", ")}`,
          });
        }

        await updateAgentConfigById(id, config);

        return {
          success: true,
          message: "Agent configuration updated successfully",
        };
      } catch (error) {
        request.log.error(error, "Error in PUT /agents/:id/config route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return reply.status(404).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while updating agent configuration",
        });
      }
    },
  );
}
