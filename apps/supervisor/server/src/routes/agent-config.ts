import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  CreateAgentConfigRequest,
  CreateAgentConfigRequestSchema,
  CreateAgentConfigResponse,
  CreateAgentConfigResponseSchema,
  ErrorResponseSchema,
  GetAgentConfigRequest,
  GetAgentConfigRequestSchema,
  GetAgentConfigResponse,
  GetAgentConfigResponseSchema,
  UpdateAgentConfigRequest,
  UpdateAgentConfigRequestSchema,
  UpdateAgentConfigResponse,
  UpdateAgentConfigResponseSchema,
} from "shared";
import {
  createAgentConfig,
  getAgentConfig,
  updateAgentConfig,
} from "../services/agentConfigService.js";
import { validateSession } from "./access.js";

export default async function agentConfigRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /agent/config - Get agent configuration
  fastify.get<{
    Querystring: GetAgentConfigRequest;
    Reply: GetAgentConfigResponse;
  }>(
    "/agent/config",
    {
      schema: {
        description: "Get agent configuration YAML for a specific user",
        tags: ["Agent Config"],
        querystring: GetAgentConfigRequestSchema,
        response: {
          200: GetAgentConfigResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { username } = request.query;
        const { config, path } = await getAgentConfig(username);

        return {
          success: true,
          message: "Agent configuration retrieved successfully",
          config,
          path,
        };
      } catch (error) {
        console.error("Error in GET /agent/config route:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return reply.status(400).send({
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

  // POST /agent/config - Create new agent configuration
  fastify.post<{
    Body: CreateAgentConfigRequest;
    Reply: CreateAgentConfigResponse;
  }>(
    "/agent/config",
    {
      schema: {
        description: "Create a new agent with YAML configuration file",
        tags: ["Agent Config"],
        body: CreateAgentConfigRequestSchema,
        response: {
          200: CreateAgentConfigResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
      preHandler: validateSession,
    },
    async (request, reply) => {
      try {
        const { name } = request.body;

        // Validate agent name (alphanumeric, hyphens, underscores only)
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return reply.status(400).send({
            success: false,
            message:
              "Agent name must contain only alphanumeric characters, hyphens, and underscores",
          });
        }

        await createAgentConfig(name);

        return {
          success: true,
          message: `Agent '${name}' created successfully`,
        };
      } catch (error) {
        console.error("Error in POST /agent/config route:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("already exists")) {
          return reply.status(400).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while creating agent",
        });
      }
    },
  );

  // PUT /agent/config - Update agent configuration
  fastify.put<{
    Body: UpdateAgentConfigRequest;
    Reply: UpdateAgentConfigResponse;
  }>(
    "/agent/config",
    {
      schema: {
        description: "Update agent configuration YAML for a specific user",
        tags: ["Agent Config"],
        body: UpdateAgentConfigRequestSchema,
        response: {
          200: UpdateAgentConfigResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
      preHandler: validateSession,
    },
    async (request, reply) => {
      try {
        const { username, config } = request.body;
        await updateAgentConfig(username, config);

        return {
          success: true,
          message: "Agent configuration updated successfully",
        };
      } catch (error) {
        console.error("Error in PUT /agent/config route:", error);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return reply.status(400).send({
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
