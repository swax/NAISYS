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

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
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

function hostActions(
  hostname: string,
  hasManageHostsPermission: boolean,
  isOnline: boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];

  if (hasManageHostsPermission) {
    actions.push({
      rel: "update",
      href: `${API_PREFIX}/hosts/${hostname}`,
      method: "PUT",
      title: "Update Host",
    });
    actions.push({
      rel: "assign-agent",
      href: `${API_PREFIX}/hosts/${hostname}/agents`,
      method: "POST",
      title: "Assign Agent",
    });
  }

  if (hasManageHostsPermission && !isOnline) {
    actions.push({
      rel: "delete",
      href: `${API_PREFIX}/hosts/${hostname}`,
      method: "DELETE",
      title: "Delete Host",
    });
  }

  return actions;
}

function assignedAgentActions(
  hostname: string,
  agentName: string,
  hasManageHostsPermission: boolean,
): HateoasAction[] {
  if (!hasManageHostsPermission) return [];
  return [
    {
      rel: "unassign",
      href: `${API_PREFIX}/hosts/${hostname}/agents/${agentName}`,
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
    async (request, reply) => {
      try {
        const hosts = await getHosts();

        const hasManageHostsPermission = hasPermission(
          request.supervisorUser,
          "manage_hosts",
        );

        const items = hosts.map((host) => {
          const online = isHostConnected(host.id);
          const actions = hostActions(
            host.name,
            hasManageHostsPermission,
            online,
          );
          return {
            ...host,
            online,
            _links: [selfLink(`/hosts/${host.name}`)],
            _actions: actions.length > 0 ? actions : undefined,
          };
        });

        const collectionActions: HateoasAction[] = [];
        if (hasManageHostsPermission) {
          collectionActions.push({
            rel: "create",
            href: `${API_PREFIX}/hosts`,
            method: "POST",
            title: "Create Host",
          });
        }

        return {
          items,
          _links: [selfLink("/hosts")],
          _actions:
            collectionActions.length > 0 ? collectionActions : undefined,
        };
      } catch (error) {
        reply.log.error(error, "Error in GET /hosts route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching hosts",
        });
      }
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
        request.log.error(error, "Error in POST /hosts route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (
          errorMessage.includes("already exists") ||
          errorMessage.includes("must contain only")
        ) {
          return reply.status(400).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while creating host",
        });
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
      try {
        const { hostname } = request.params;
        const host = await getHostDetail(hostname);

        if (!host) {
          return reply.status(404).send({
            success: false,
            message: `Host "${hostname}" not found`,
          });
        }

        const hasManageHostsPermission = hasPermission(
          request.supervisorUser,
          "manage_hosts",
        );

        const online = isHostConnected(host.id);

        return {
          ...host,
          online,
          assignedAgents: host.assignedAgents.map((agent) => ({
            ...agent,
            _actions: assignedAgentActions(
              hostname,
              agent.name,
              hasManageHostsPermission,
            ),
          })),
          _links: [selfLink(`/hosts/${hostname}`)],
          _actions: hostActions(hostname, hasManageHostsPermission, online),
        };
      } catch (error) {
        request.log.error(error, "Error in GET /hosts/:hostname route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching host detail",
        });
      }
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
          return reply.status(404).send({
            success: false,
            message: `Host "${hostname}" not found`,
          });
        }

        // Name change only allowed when offline
        if (body.name !== undefined && isHostConnected(host.id)) {
          return reply.status(400).send({
            success: false,
            message: "Cannot rename an online host. Disconnect it first.",
          });
        }

        await updateHost(hostname, body);

        sendHostsChanged();

        return { success: true, message: "Host updated" };
      } catch (error) {
        request.log.error(error, "Error in PUT /hosts/:hostname route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return reply.status(404).send({
            success: false,
            message: errorMessage,
          });
        }
        if (
          errorMessage.includes("already exists") ||
          errorMessage.includes("must contain only")
        ) {
          return reply.status(400).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while updating host",
        });
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
      try {
        const { hostname } = request.params;

        const hosts = await getHosts();
        const host = hosts.find((h) => h.name === hostname);

        if (!host) {
          return reply.status(404).send({
            success: false,
            message: `Host "${hostname}" not found`,
          });
        }

        if (isHostConnected(host.id)) {
          return reply.status(400).send({
            success: false,
            message: "Cannot delete an online host. Disconnect it first.",
          });
        }

        await deleteHost(hostname);

        sendHostsChanged();

        return { success: true, message: "Host permanently deleted" };
      } catch (error) {
        request.log.error(error, "Error in DELETE /hosts/:hostname route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while deleting host",
        });
      }
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
        request.log.error(error, "Error in POST /hosts/:hostname/agents route");
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return reply.status(404).send({
            success: false,
            message: errorMessage,
          });
        }
        if (errorMessage.includes("already assigned")) {
          return reply.status(400).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while assigning agent",
        });
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
        request.log.error(
          error,
          "Error in DELETE /hosts/:hostname/agents/:agentName route",
        );
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not assigned")) {
          return reply.status(400).send({
            success: false,
            message: errorMessage,
          });
        }

        return reply.status(500).send({
          success: false,
          message: "Internal server error while unassigning agent",
        });
      }
    },
  );
}
