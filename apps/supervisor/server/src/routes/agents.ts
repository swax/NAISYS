import {
  AgentDetailResponse,
  AgentDetailResponseSchema,
  AgentIdParams,
  AgentIdParamsSchema,
  AgentListRequest,
  AgentListRequestSchema,
  AgentListResponse,
  AgentListResponseSchema,
  CreateAgentConfigRequest,
  CreateAgentConfigRequestSchema,
  CreateAgentConfigResponse,
  CreateAgentConfigResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { HateoasAction } from "@naisys/common";
import { requirePermission } from "../auth-middleware.js";
import {
  API_PREFIX,
  collectionLink,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import { isAgentActive } from "../services/hubConnectionService.js";
import { createAgentConfig } from "../services/agentConfigService.js";
import { getAgent, getAgents } from "../services/agentService.js";

function agentActions(
  agentId: number,
  hasManagePermission: boolean,
  archived: boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];
  const active = isAgentActive(agentId);

  if (hasManagePermission && !active && !archived) {
    actions.push({
      rel: "start",
      href: `${API_PREFIX}/agents/${agentId}/start`,
      method: "POST",
      title: "Start Agent",
      schema: `${API_PREFIX}/schemas/StartAgent`,
    });
  }
  if (hasManagePermission && active) {
    actions.push({
      rel: "stop",
      href: `${API_PREFIX}/agents/${agentId}/stop`,
      method: "POST",
      title: "Stop Agent",
    });
  }
  if (hasManagePermission && !active && !archived) {
    actions.push({
      rel: "archive",
      href: `${API_PREFIX}/agents/${agentId}/archive`,
      method: "POST",
      title: "Archive Agent",
    });
  }
  if (hasManagePermission && archived) {
    actions.push({
      rel: "unarchive",
      href: `${API_PREFIX}/agents/${agentId}/unarchive`,
      method: "POST",
      title: "Unarchive Agent",
    });
  }
  if (hasManagePermission && !active && archived) {
    actions.push({
      rel: "delete",
      href: `${API_PREFIX}/agents/${agentId}`,
      method: "DELETE",
      title: "Delete Agent",
    });
  }
  if (hasManagePermission && !archived) {
    actions.push({
      rel: "update-config",
      href: `${API_PREFIX}/agents/${agentId}/config`,
      method: "PUT",
      title: "Update Agent Config",
      schema: `${API_PREFIX}/schemas/UpdateAgentConfig`,
    });
    actions.push({
      rel: "set-lead",
      href: `${API_PREFIX}/agents/${agentId}/lead`,
      method: "PUT",
      title: "Set Lead Agent",
      schema: `${API_PREFIX}/schemas/SetLeadAgent`,
    });
  }
  return actions;
}

function agentLinks(agentId: number) {
  return [
    selfLink(`/agents/${agentId}`),
    { rel: "config", href: `${API_PREFIX}/agents/${agentId}/config` },
    { rel: "runs", href: `${API_PREFIX}/agents/${agentId}/runs` },
    { rel: "mail", href: `${API_PREFIX}/agents/${agentId}/mail` },
    collectionLink("agents"),
  ];
}

export default async function agentsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET / — List agents
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
          online: isAgentActive(agent.id),
          _links: agentLinks(agent.id),
        }));

        const hasManagePermission =
          request.supervisorUser?.permissions.includes("manage_agents") ??
          false;

        const actions: HateoasAction[] = [];
        if (hasManagePermission) {
          actions.push({
            rel: "create",
            href: `${API_PREFIX}/agents`,
            method: "POST",
            title: "Create Agent",
            schema: `${API_PREFIX}/schemas/CreateAgent`,
          });
        }

        return {
          items,
          timestamp: new Date().toISOString(),
          _links: [selfLink("/agents"), schemaLink("CreateAgent")],
          _actions: actions.length > 0 ? actions : undefined,
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

  // POST / — Create agent
  fastify.post<{
    Body: CreateAgentConfigRequest;
    Reply: CreateAgentConfigResponse;
  }>(
    "/",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Create a new agent with YAML configuration file",
        tags: ["Agents"],
        body: CreateAgentConfigRequestSchema,
        response: {
          200: CreateAgentConfigResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { name } = request.body;

        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return reply.status(400).send({
            success: false,
            message:
              "Agent name must contain only alphanumeric characters, hyphens, and underscores",
          });
        }

        const agentId = await createAgentConfig(name);

        return {
          success: true,
          message: `Agent '${name}' created successfully`,
          id: agentId,
          _links: agentLinks(agentId),
          _actions: agentActions(agentId, true, false),
        };
      } catch (error) {
        request.log.error(error, "Error in POST /agents route");
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

  // GET /:id — Agent detail with config
  fastify.get<{
    Params: AgentIdParams;
    Reply: AgentDetailResponse | ErrorResponse;
  }>(
    "/:id",
    {
      schema: {
        description: "Get agent detail with configuration",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentDetailResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const agent = await getAgent(id);

        if (!agent) {
          return reply.status(404).send({
            success: false,
            message: `Agent with ID ${id} not found`,
          });
        }

        const hasManagePermission =
          request.supervisorUser?.permissions.includes("manage_agents") ??
          false;

        return {
          ...agent,
          online: isAgentActive(id),
          _links: agentLinks(id),
          _actions: agentActions(
            id,
            hasManagePermission,
            agent.archived ?? false,
          ),
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:id route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agent detail",
        });
      }
    },
  );
}
