import type { AgentConfigFile, HateoasAction } from "@naisys/common";
import type {
  AgentDetailResponse,
  AgentListRequest,
  AgentListResponse,
  AgentUsernameParams,
  CreateAgentConfigRequest,
  CreateAgentConfigResponse,
  ErrorResponse,
} from "@naisys/supervisor-shared";
import {
  AgentDetailResponseSchema,
  AgentListRequestSchema,
  AgentListResponseSchema,
  AgentUsernameParamsSchema,
  CreateAgentConfigRequestSchema,
  CreateAgentConfigResponseSchema,
  ErrorResponseSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import type { SupervisorUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { badRequest, notFound } from "../error-helpers.js";
import {
  API_PREFIX,
  collectionLink,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import { resolveActions } from "../route-helpers.js";
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
import { getVariableCachedValue } from "../services/variableService.js";

type AgentCtx = {
  user: SupervisorUser | undefined;
  active: boolean;
  archived: boolean;
  enabled: boolean;
  hasSpendLimit: boolean;
};

function agentActions(
  username: string,
  user: SupervisorUser | undefined,
  enabled: boolean,
  archived: boolean,
  agentId?: number,
  hasSpendLimit?: boolean,
): HateoasAction[] {
  const active = agentId ? isAgentActive(agentId) : false;
  const href = `${API_PREFIX}/agents/${username}`;

  return resolveActions<AgentCtx>(
    [
      {
        rel: "start",
        path: "/start",
        method: "POST",
        title: "Start Agent",
        schema: `${API_PREFIX}/schemas/StartAgent`,
        body: { task: "" },
        permission: "manage_agents",
        disabledWhen: (ctx) =>
          ctx.active
            ? "Agent is already running"
            : ctx.archived
              ? "Agent is archived"
              : !ctx.enabled
                ? "Agent is disabled"
                : null,
      },
      {
        rel: "stop",
        path: "/stop",
        method: "POST",
        title: "Stop Agent",
        permission: "manage_agents",
        disabledWhen: (ctx) => (!ctx.active ? "Agent is not running" : null),
      },
      {
        rel: "disable",
        path: "/disable",
        method: "POST",
        title: "Disable Agent",
        permission: "manage_agents",
        visibleWhen: (ctx) => !ctx.archived && ctx.enabled,
      },
      {
        rel: "enable",
        path: "/enable",
        method: "POST",
        title: "Enable Agent",
        permission: "manage_agents",
        visibleWhen: (ctx) => !ctx.archived && !ctx.enabled && !ctx.active,
      },
      {
        rel: "archive",
        path: "/archive",
        method: "POST",
        title: "Archive Agent",
        permission: "manage_agents",
        visibleWhen: (ctx) => !ctx.archived,
        disabledWhen: (ctx) =>
          ctx.active ? "Stop the agent before archiving" : null,
      },
      {
        rel: "unarchive",
        path: "/unarchive",
        method: "POST",
        title: "Unarchive Agent",
        permission: "manage_agents",
        visibleWhen: (ctx) => ctx.archived,
      },
      {
        rel: "delete",
        method: "DELETE",
        title: "Delete Agent",
        permission: "manage_agents",
        visibleWhen: (ctx) => !ctx.active && ctx.archived,
        hideWithoutPermission: true,
      },
      {
        rel: "update-config",
        path: "/config",
        method: "PUT",
        title: "Update Agent Config",
        schema: `${API_PREFIX}/schemas/UpdateAgentConfig`,
        permission: "manage_agents",
        visibleWhen: (ctx) => !ctx.archived,
      },
      {
        rel: "set-lead",
        path: "/lead",
        method: "PUT",
        title: "Set Lead Agent",
        schema: `${API_PREFIX}/schemas/SetLeadAgent`,
        body: { leadAgentUsername: "" },
        permission: "manage_agents",
        visibleWhen: (ctx) => !ctx.archived,
      },
      {
        rel: "reset-spend",
        path: "/reset-spend",
        method: "POST",
        title: "Reset Spend",
        permission: "manage_agents",
        visibleWhen: (ctx) => !ctx.archived && ctx.hasSpendLimit,
      },
    ],
    href,
    { user, active, archived, enabled, hasSpendLimit: hasSpendLimit ?? false },
  );
}

function agentLinks(
  username: string,
  config: AgentConfigFile | null | undefined,
  mailServiceEnabled: boolean,
) {
  const links = [
    selfLink(`/agents/${username}`),
    { rel: "config", href: `${API_PREFIX}/agents/${username}/config` },
    { rel: "runs", href: `${API_PREFIX}/agents/${username}/runs` },
    collectionLink("agents"),
  ];
  if (mailServiceEnabled && config?.mailEnabled) {
    links.push({ rel: "mail", href: `${API_PREFIX}/agents/${username}/mail` });
  }
  if (config?.chatEnabled) {
    links.push({ rel: "chat", href: `${API_PREFIX}/agents/${username}/chat` });
  }
  return links;
}

async function isMailServiceEnabled(): Promise<boolean> {
  return (await getVariableCachedValue("MAIL_ENABLED")) === "true";
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
    async (request, _reply) => {
      const { updatedSince } = request.query;
      const agents = await getAgents(updatedSince);

      const items = agents.map((agent) => ({
        ...agent,
        status: getAgentStatus(agent.id),
      }));

      const hasManagePermission = hasPermission(
        request.supervisorUser,
        "manage_agents",
      );

      const actions: HateoasAction[] = [
        {
          rel: "create",
          href: `${API_PREFIX}/agents`,
          method: "POST",
          title: "Create Agent",
          schema: `${API_PREFIX}/schemas/CreateAgent`,
          body: { name: "" },
          ...(hasManagePermission
            ? {}
            : {
                disabled: true,
                disabledReason: "Requires manage_agents permission",
              }),
        },
      ];

      return {
        items,
        timestamp: new Date().toISOString(),
        _links: [selfLink("/agents"), schemaLink("CreateAgent")],
        _linkTemplates: [
          { rel: "item", hrefTemplate: `${API_PREFIX}/agents/{name}` },
        ],
        _actions: actions,
      };
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
          return badRequest(
            reply,
            "Agent name must contain only alphanumeric characters, hyphens, and underscores",
          );
        }

        const { config } = await createAgentConfig(name, title);

        return {
          success: true,
          message: `Agent '${name}' created successfully`,
          name,
          _links: agentLinks(name, config, await isMailServiceEnabled()),
          _actions: agentActions(name, request.supervisorUser, true, false),
        };
      } catch (error) {
        request.log.error(error, "Error in POST /agents route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("already exists")) {
          return badRequest(reply, errorMessage);
        }

        throw error;
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
      const { username } = request.params;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      const agent = await getAgent(id);

      if (!agent) {
        return notFound(reply, `Agent '${username}' not found`);
      }

      return {
        ...agent,
        status: getAgentStatus(id),
        _links: agentLinks(username, agent.config, await isMailServiceEnabled()),
        _actions: agentActions(
          username,
          request.supervisorUser,
          agent.enabled ?? false,
          agent.archived ?? false,
          id,
          agent.config?.spendLimitDollars != null,
        ),
      };
    },
  );
}
