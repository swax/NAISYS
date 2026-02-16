import {
  AgentIdParams,
  AgentIdParamsSchema,
  ErrorResponseSchema,
  GetAgentConfigResponse,
  GetAgentConfigResponseSchema,
  UpdateAgentConfigRequest,
  UpdateAgentConfigRequestSchema,
  UpdateAgentConfigResponse,
  UpdateAgentConfigResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { requirePermission } from "../auth-middleware.js";
import {
  getAgentConfigById,
  updateAgentConfigById,
} from "../services/agentConfigService.js";
import { ErrorResponse } from "@naisys-supervisor/shared";

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

        return { config };
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
