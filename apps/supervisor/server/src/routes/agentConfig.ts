import {
  AgentIdParams,
  AgentIdParamsSchema,
  ErrorResponse,
  ErrorResponseSchema,
  ExportAgentConfigResponse,
  ExportAgentConfigResponseSchema,
  GetAgentConfigResponse,
  GetAgentConfigResponseSchema,
  ImportAgentConfigRequest,
  ImportAgentConfigRequestSchema,
  ImportAgentConfigResponse,
  ImportAgentConfigResponseSchema,
  UpdateAgentConfigRequest,
  UpdateAgentConfigRequestSchema,
  UpdateAgentConfigResponse,
  UpdateAgentConfigResponseSchema,
} from "@naisys-supervisor/shared";
import type { AgentConfigFile, ModelDbRow } from "@naisys/common";
import { AgentConfigFileSchema } from "@naisys/common";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import yaml from "js-yaml";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { API_PREFIX } from "../hateoas.js";
import {
  getAgentConfigById,
  updateAgentConfigById,
} from "../services/agentConfigService.js";
import { getAllModelsFromDb } from "../services/modelService.js";

/** Validate model keys in config against known models. Returns error message or null. */
async function validateModelKeys(
  config: AgentConfigFile,
): Promise<string | null> {
  const isTemplateVar = (v: string) => /^\$\{.+\}$/.test(v);

  const allModels = await getAllModelsFromDb();
  const keysOfType = (type: string) =>
    new Set(
      allModels
        .filter((r: ModelDbRow) => r.type === type)
        .map((r: ModelDbRow) => r.key),
    );
  const validLlmKeys = keysOfType("llm");
  const validImageKeys = keysOfType("image");

  const invalidModels: string[] = [];
  if (
    !isTemplateVar(config.shellModel) &&
    !validLlmKeys.has(config.shellModel)
  ) {
    invalidModels.push(`shellModel: "${config.shellModel}"`);
  }
  if (
    config.imageModel &&
    !isTemplateVar(config.imageModel) &&
    !validImageKeys.has(config.imageModel)
  ) {
    invalidModels.push(`imageModel: "${config.imageModel}"`);
  }

  if (invalidModels.length > 0) {
    return `Invalid model key(s): ${invalidModels.join(", ")}`;
  }
  return null;
}

export default function agentConfigRoutes(
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

        const canManage = hasPermission(
          request.supervisorUser,
          "manage_agents",
        );
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
                {
                  rel: "import-config",
                  href: `${API_PREFIX}/agents/${id}/config/import`,
                  method: "POST" as const,
                  title: "Import Config",
                },
                {
                  rel: "export-config",
                  href: `${API_PREFIX}/agents/${id}/config/export`,
                  method: "GET" as const,
                  title: "Export Config",
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

        // Validate model keys against known models
        const modelError = await validateModelKeys(config);
        if (modelError) {
          return reply.status(400).send({
            success: false,
            message: modelError,
          });
        }

        await updateAgentConfigById(id, config, true);

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

  // GET /:id/config/export — Export agent config as YAML
  fastify.get<{
    Params: AgentIdParams;
    Reply: ExportAgentConfigResponse | ErrorResponse;
  }>(
    "/:id/config/export",
    {
      schema: {
        description: "Export agent configuration as YAML",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: ExportAgentConfigResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const config = await getAgentConfigById(id);
        const yamlString = yaml.dump(config, { lineWidth: -1 });

        return { yaml: yamlString };
      } catch (error) {
        request.log.error(
          error,
          "Error in GET /agents/:id/config/export route",
        );
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
          message: "Internal server error while exporting agent configuration",
        });
      }
    },
  );

  // POST /:id/config/import — Import agent config from YAML
  fastify.post<{
    Params: AgentIdParams;
    Body: ImportAgentConfigRequest;
    Reply: ImportAgentConfigResponse;
  }>(
    "/:id/config/import",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Import agent configuration from YAML",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        body: ImportAgentConfigRequestSchema,
        response: {
          200: ImportAgentConfigResponseSchema,
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
        const { yaml: yamlString } = request.body;

        // Parse YAML
        let parsed: unknown;
        try {
          parsed = yaml.load(yamlString);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Invalid YAML syntax";
          return reply.status(400).send({
            success: false,
            message: `YAML parse error: ${message}`,
          });
        }

        // Validate against schema
        let config: AgentConfigFile;
        try {
          config = AgentConfigFileSchema.parse(parsed);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Invalid config structure";
          return reply.status(400).send({
            success: false,
            message: `Config validation error: ${message}`,
          });
        }

        // Validate model keys
        const modelError = await validateModelKeys(config);
        if (modelError) {
          return reply.status(400).send({
            success: false,
            message: modelError,
          });
        }

        await updateAgentConfigById(id, config, false);

        return {
          success: true,
          message: "Agent configuration imported successfully",
        };
      } catch (error) {
        request.log.error(
          error,
          "Error in POST /agents/:id/config/import route",
        );
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
          message: "Internal server error while importing agent configuration",
        });
      }
    },
  );
}
