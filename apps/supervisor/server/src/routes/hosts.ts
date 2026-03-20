import type { HateoasAction } from "@naisys/common";
import {
  AgentActionResult,
  AgentActionResultSchema,
  AgentNameParamSchema,
  AssignAgentToHostRequest,
  AssignAgentToHostRequestSchema,
  CreateHostRequest,
  CreateHostRequestSchema,
  ErrorResponse,
  ErrorResponseSchema,
  HostDetailResponse,
  HostDetailResponseSchema,
  HostListResponse,
  HostListResponseSchema,
  HostNameParams,
  HostNameParamsSchema,
  UpdateHostRequest,
  UpdateHostRequestSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

import type { SupervisorUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { badRequest, conflict, notFound } from "../error-helpers.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import { permGate, resolveActions } from "../route-helpers.js";
import {
  emitHostsListChanged,
  isHostConnected,
} from "../services/agentHostStatusService.js";
import {
  assignAgentToHost,
  createHost,
  deleteHost,
  getHostDetail,
  getHosts,
  unassignAgentFromHost,
  updateHost,
} from "../services/hostService.js";
import {
  sendHostsChanged,
  sendUserListChanged,
} from "../services/hubConnectionService.js";

type HostCtx = {
  user: SupervisorUser | undefined;
  isOnline: boolean;
};

function hostActions(
  hostname: string,
  user: SupervisorUser | undefined,
  isOnline: boolean,
): HateoasAction[] {
  const href = `${API_PREFIX}/hosts/${hostname}`;

  return resolveActions<HostCtx>(
    [
      {
        rel: "update",
        method: "PUT",
        title: "Update Host",
        permission: "manage_hosts",
      },
      {
        rel: "assign-agent",
        path: "/agents",
        method: "POST",
        title: "Assign Agent",
        permission: "manage_hosts",
      },
      {
        rel: "delete",
        method: "DELETE",
        title: "Delete Host",
        permission: "manage_hosts",
        disabledWhen: (ctx) =>
          ctx.isOnline ? "Host must be offline before deletion" : null,
      },
    ],
    href,
    { user, isOnline },
  );
}

function hostActionTemplates(
  hostname: string,
  hasManageHostsPermission: boolean,
) {
  if (!hasManageHostsPermission) return [];
  return [
    {
      rel: "unassignAgent",
      hrefTemplate: `${API_PREFIX}/hosts/${hostname}/agents/{agentName}`,
      method: "DELETE",
      title: "Unassign Agent",
    },
  ];
}

export default function hostsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET / — List hosts
  fastify.get<{
    Reply: HostListResponse | ErrorResponse;
  }>(
    "/",
    {
      schema: {
        description: "List hosts with status",
        tags: ["Hosts"],
        response: {
          200: HostListResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, _reply) => {
      const hosts = await getHosts();

      const user = request.supervisorUser;
      const hasManageHostsPermission = hasPermission(user, "manage_hosts");

      const items = hosts.map((host) => {
        const online = isHostConnected(host.id);
        return {
          ...host,
          online,
          _links: [selfLink(`/hosts/${host.name}`)],
          _actions: hostActions(host.name, user, online),
        };
      });

      return {
        items,
        _links: [selfLink("/hosts")],
        _actions: [
          {
            rel: "create",
            href: `${API_PREFIX}/hosts`,
            method: "POST" as const,
            title: "Create Host",
            ...permGate(hasManageHostsPermission, "manage_hosts"),
          },
        ],
      };
    },
  );

  // POST / — Create host
  fastify.post<{
    Body: CreateHostRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Create a new host",
        tags: ["Hosts"],
        body: CreateHostRequestSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { name } = request.body;
        const { id } = await createHost(name);

        sendHostsChanged();

        return {
          success: true,
          message: `Host '${name}' created successfully`,
          id,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("already exists")) {
          return conflict(reply, errorMessage);
        }
        if (errorMessage.includes("must contain only")) {
          return badRequest(reply, errorMessage);
        }

        throw error;
      }
    },
  );

  // GET /:hostname — Host detail
  fastify.get<{
    Params: HostNameParams;
    Reply: HostDetailResponse | ErrorResponse;
  }>(
    "/:hostname",
    {
      schema: {
        description: "Get host detail with assigned agents",
        tags: ["Hosts"],
        params: HostNameParamsSchema,
        response: {
          200: HostDetailResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { hostname } = request.params;
      const host = await getHostDetail(hostname);

      if (!host) {
        return notFound(reply, `Host "${hostname}" not found`);
      }

      const user = request.supervisorUser;
      const hasManageHostsPermission = hasPermission(user, "manage_hosts");
      const online = isHostConnected(host.id);

      return {
        ...host,
        online,
        assignedAgents: host.assignedAgents,
        _links: [selfLink(`/hosts/${hostname}`)],
        _actions: hostActions(hostname, user, online),
        _actionTemplates: hostActionTemplates(
          hostname,
          hasManageHostsPermission,
        ),
      };
    },
  );

  // PUT /:hostname — Update host
  fastify.put<{
    Params: HostNameParams;
    Body: UpdateHostRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:hostname",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Update host name and/or restricted flag",
        tags: ["Hosts"],
        params: HostNameParamsSchema,
        body: UpdateHostRequestSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { hostname } = request.params;
        const body = request.body;

        // Look up host to get id for online check
        const host = await getHostDetail(hostname);
        if (!host) {
          return notFound(reply, `Host "${hostname}" not found`);
        }

        // Name change only allowed when offline
        if (body.name !== undefined && isHostConnected(host.id)) {
          return badRequest(
            reply,
            "Cannot rename an online host. Disconnect it first.",
          );
        }

        await updateHost(hostname, body);

        sendHostsChanged();

        return { success: true, message: "Host updated" };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return notFound(reply, errorMessage);
        }
        if (errorMessage.includes("already exists")) {
          return conflict(reply, errorMessage);
        }
        if (errorMessage.includes("must contain only")) {
          return badRequest(reply, errorMessage);
        }

        throw error;
      }
    },
  );

  // DELETE /:hostname — Permanently delete a host
  fastify.delete<{
    Params: HostNameParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:hostname",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Permanently delete an offline host",
        tags: ["Hosts"],
        params: HostNameParamsSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { hostname } = request.params;

      const hosts = await getHosts();
      const host = hosts.find((h) => h.name === hostname);

      if (!host) {
        return notFound(reply, `Host "${hostname}" not found`);
      }

      if (isHostConnected(host.id)) {
        return badRequest(
          reply,
          "Cannot delete an online host. Disconnect it first.",
        );
      }

      await deleteHost(hostname);

      sendHostsChanged();

      return { success: true, message: "Host permanently deleted" };
    },
  );

  // POST /:hostname/agents — Assign agent to host
  fastify.post<{
    Params: HostNameParams;
    Body: AssignAgentToHostRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:hostname/agents",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Assign an agent to this host",
        tags: ["Hosts"],
        params: HostNameParamsSchema,
        body: AssignAgentToHostRequestSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { hostname } = request.params;
        const { agentId } = request.body;

        await assignAgentToHost(hostname, agentId);

        sendUserListChanged();
        emitHostsListChanged();

        return { success: true, message: "Agent assigned to host" };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return notFound(reply, errorMessage);
        }
        if (errorMessage.includes("already assigned")) {
          return conflict(reply, errorMessage);
        }

        throw error;
      }
    },
  );

  // DELETE /:hostname/agents/:agentName — Unassign agent from host
  fastify.delete<{
    Params: HostNameParams & { agentName: string };
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:hostname/agents/:agentName",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Unassign an agent from this host",
        tags: ["Hosts"],
        params: HostNameParamsSchema.merge(AgentNameParamSchema),
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { hostname, agentName } = request.params;

        await unassignAgentFromHost(hostname, agentName);

        sendUserListChanged();
        emitHostsListChanged();

        return { success: true, message: "Agent unassigned from host" };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not assigned")) {
          return badRequest(reply, errorMessage);
        }

        throw error;
      }
    },
  );
}
