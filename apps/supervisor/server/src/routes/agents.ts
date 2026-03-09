import type { AgentConfigFile, HateoasAction } from "@naisys/common";
import {
  AgentDetailResponse,
  AgentDetailResponseSchema,
  AgentListRequest,
  AgentListRequestSchema,
  AgentListResponse,
  AgentListResponseSchema,
  AgentUsernameParams,
  AgentUsernameParamsSchema,
  CreateAgentConfigRequest,
  CreateAgentConfigRequestSchema,
  CreateAgentConfigResponse,
  CreateAgentConfigResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import {
  API_PREFIX,
  collectionLink,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import { createAgentConfig } from "../services/agentConfigService.js";
import {
  getAgentStatus,
  isAgentActive,
} from "../services/agentHostStatusService.js";
import {
  getAgent,
  getAgents,
  resolveAgentId,
} from "../services/agentService.js";

function agentActions(
  username: string,
  hasManagePermission: boolean,
  archived: boolean,
  agentId?: number,
): HateoasAction[] {
  const actions: HateoasAction[] = [];
  const active = agentId ? isAgentActive(agentId) : false;

  if (hasManagePermission && !active && !archived) {
    actions.push({
      rel: "start",
      href: `${API_PREFIX}/agents/${username}/start`,
      method: "POST",
      title: "Start Agent",
      schema: `${API_PREFIX}/schemas/StartAgent`,
    });
  }
  if (hasManagePermission && active) {
    actions.push({
      rel: "stop",
      href: `${API_PREFIX}/agents/${username}/stop`,
      method: "POST",
      title: "Stop Agent",
    });
  }
  if (hasManagePermission && !active && !archived) {
    actions.push({
      rel: "archive",
      href: `${API_PREFIX}/agents/${username}/archive`,
      method: "POST",
      title: "Archive Agent",
    });
  }
  if (hasManagePermission && archived) {
    actions.push({
      rel: "unarchive",
      href: `${API_PREFIX}/agents/${username}/unarchive`,
      method: "POST",
      title: "Unarchive Agent",
    });
  }
  if (hasManagePermission && !active && archived) {
    actions.push({
      rel: "delete",
      href: `${API_PREFIX}/agents/${username}`,
      method: "DELETE",
      title: "Delete Agent",
    });
  }
  if (hasManagePermission && !archived) {
    actions.push({
      rel: "update-config",
      href: `${API_PREFIX}/agents/${username}/config`,
      method: "PUT",
      title: "Update Agent Config",
      schema: `${API_PREFIX}/schemas/UpdateAgentConfig`,
    });
    actions.push({
      rel: "set-lead",
      href: `${API_PREFIX}/agents/${username}/lead`,
      method: "PUT",
      title: "Set Lead Agent",
      schema: `${API_PREFIX}/schemas/SetLeadAgent`,
    });
  }
  return actions;
}

function agentLinks(
  username: string,
  config: AgentConfigFile | null | undefined,
) {
  const links = [
    selfLink(`/agents/${username}`),
    { rel: "config", href: `${API_PREFIX}/agents/${username}/config` },
    { rel: "runs", href: `${API_PREFIX}/agents/${username}/runs` },
    collectionLink("agents"),
  ];
  if (config?.mailEnabled) {
    links.push({ rel: "mail", href: `${API_PREFIX}/agents/${username}/mail` });
  }
  if (config?.chatEnabled) {
    links.push({ rel: "chat", href: `${API_PREFIX}/agents/${username}/chat` });
  }
  return links;
}

export default function agentsRoutes(
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
          status: getAgentStatus(agent.id),
          _links: [selfLink(`/agents/${agent.name}`)],
        }));

        const hasManagePermission = hasPermission(
          request.supervisorUser,
          "manage_agents",
        );

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
        description: "Create a new agent with configuration file",
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
        const { name, title } = request.body;

        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return reply.status(400).send({
            success: false,
            message:
              "Agent name must contain only alphanumeric characters, hyphens, and underscores",
          });
        }

        const { config } = await createAgentConfig(name, title);

        return {
          success: true,
          message: `Agent '${name}' created successfully`,
          name,
          _links: agentLinks(name, config),
          _actions: agentActions(name, true, false),
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

  // GET /:username — Agent detail with config
  fastify.get<{
    Params: AgentUsernameParams;
    Reply: AgentDetailResponse | ErrorResponse;
  }>(
    "/:username",
    {
      schema: {
        description: "Get agent detail with configuration",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        response: {
          200: AgentDetailResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { username } = request.params;
        const id = resolveAgentId(username);

        if (!id) {
          return reply.status(404).send({
            success: false,
            message: `Agent '${username}' not found`,
          });
        }

        const agent = await getAgent(id);

        if (!agent) {
          return reply.status(404).send({
            success: false,
            message: `Agent '${username}' not found`,
          });
        }

        const hasManagePermission = hasPermission(
          request.supervisorUser,
          "manage_agents",
        );

        return {
          ...agent,
          status: getAgentStatus(id),
          _links: agentLinks(username, agent.config),
          _actions: agentActions(
            username,
            hasManagePermission,
            agent.archived ?? false,
            id,
          ),
        };
      } catch (error) {
        request.log.error(error, "Error in GET /agents/:username route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agent detail",
        });
      }
    },
  );
}
