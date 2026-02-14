import {
  AgentListRequest,
  AgentListRequestSchema,
  AgentListResponse,
  AgentListResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { selfLink } from "../hateoas.js";
import { getAgents } from "../services/agentService.js";

export default async function agentsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{
    Querystring: AgentListRequest;
    Reply: AgentListResponse | ErrorResponse;
  }>(
    "/",
    {
      schema: {
        description: "List agents with status and metadata",
        tags: ["Agents"],
        querystring: AgentListRequestSchema,
        response: {
          200: AgentListResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { updatedSince } = request.query;
        const agents = await getAgents(updatedSince);

        const items = agents.map((agent) => ({
          ...agent,
          _links: [selfLink(`/agents/${agent.id}`)],
        }));

        return {
          items,
          timestamp: new Date().toISOString(),
          _links: [selfLink("/agents")],
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agents",
        });
      }
    },
  );
}
