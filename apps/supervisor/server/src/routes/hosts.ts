import type { HateoasAction } from "@naisys/common";
import {
  AgentActionResult,
  AgentActionResultSchema,
  AgentIdParamSchema,
  AssignAgentToHostRequest,
  AssignAgentToHostRequestSchema,
  CreateHostRequest,
  CreateHostRequestSchema,
  ErrorResponse,
  ErrorResponseSchema,
  HostDetailResponse,
  HostDetailResponseSchema,
  HostIdParams,
  HostIdParamsSchema,
  HostListResponse,
  HostListResponseSchema,
  UpdateHostRequest,
  UpdateHostRequestSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import { isHostConnected } from "../services/agentHostStatusService.js";
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
  hostId: number,
  hasManageHostsPermission: boolean,
  isOnline: boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];

  if (hasManageHostsPermission) {
    actions.push({
      rel: "update",
      href: `${API_PREFIX}/hosts/${hostId}`,
      method: "PUT",
      title: "Update Host",
    });
    actions.push({
      rel: "assign-agent",
      href: `${API_PREFIX}/hosts/${hostId}/agents`,
      method: "POST",
      title: "Assign Agent",
    });
  }

  if (hasManageHostsPermission && !isOnline) {
    actions.push({
      rel: "delete",
      href: `${API_PREFIX}/hosts/${hostId}`,
      method: "DELETE",
      title: "Delete Host",
    });
  }

  return actions;
}

function assignedAgentActions(
  hostId: number,
  agentId: number,
  hasManageHostsPermission: boolean,
): HateoasAction[] {
  if (!hasManageHostsPermission) return [];
  return [
    {
      rel: "unassign",
      href: `${API_PREFIX}/hosts/${hostId}/agents/${agentId}`,
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
          const actions = hostActions(host.id, hasManageHostsPermission, online);
          return {
            ...host,
            online,
            _links: [selfLink(`/hosts/${host.id}`)],
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

  // GET /:id — Host detail
  fastify.get<{
    Params: HostIdParams;
    Reply: HostDetailResponse | ErrorResponse;
  }>(
    "/:id",
    {
      schema: {
        description: "Get host detail with assigned agents",
        tags: ["Hosts"],
        params: HostIdParamsSchema,
        response: {
          200: HostDetailResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const host = await getHostDetail(id);

        if (!host) {
          return reply.status(404).send({
            success: false,
            message: `Host with ID ${id} not found`,
          });
        }

        const hasManageHostsPermission = hasPermission(
          request.supervisorUser,
          "manage_hosts",
        );

        const online = isHostConnected(id);

        return {
          ...host,
          online,
          assignedAgents: host.assignedAgents.map((agent) => ({
            ...agent,
            _actions: assignedAgentActions(
              id,
              agent.id,
              hasManageHostsPermission,
            ),
          })),
          _links: [selfLink(`/hosts/${id}`)],
          _actions: hostActions(id, hasManageHostsPermission, online),
        };
      } catch (error) {
        request.log.error(error, "Error in GET /hosts/:id route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching host detail",
        });
      }
    },
  );

  // PUT /:id — Update host
  fastify.put<{
    Params: HostIdParams;
    Body: UpdateHostRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Update host name and/or restricted flag",
        tags: ["Hosts"],
        params: HostIdParamsSchema,
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
        const { id } = request.params;
        const body = request.body;

        // Name change only allowed when offline
        if (body.name !== undefined && isHostConnected(id)) {
          return reply.status(400).send({
            success: false,
            message: "Cannot rename an online host. Disconnect it first.",
          });
        }

        await updateHost(id, body);

        sendHostsChanged();

        return { success: true, message: "Host updated" };
      } catch (error) {
        request.log.error(error, "Error in PUT /hosts/:id route");
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

  // DELETE /:id — Permanently delete a host
  fastify.delete<{
    Params: HostIdParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Permanently delete an offline host",
        tags: ["Hosts"],
        params: HostIdParamsSchema,
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
        const { id } = request.params;

        const hosts = await getHosts();
        const host = hosts.find((h) => h.id === id);

        if (!host) {
          return reply.status(404).send({
            success: false,
            message: `Host with ID ${id} not found`,
          });
        }

        if (isHostConnected(id)) {
          return reply.status(400).send({
            success: false,
            message: "Cannot delete an online host. Disconnect it first.",
          });
        }

        await deleteHost(id);

        sendHostsChanged();

        return { success: true, message: "Host permanently deleted" };
      } catch (error) {
        request.log.error(error, "Error in DELETE /hosts/:id route");
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

  // POST /:id/agents — Assign agent to host
  fastify.post<{
    Params: HostIdParams;
    Body: AssignAgentToHostRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id/agents",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Assign an agent to this host",
        tags: ["Hosts"],
        params: HostIdParamsSchema,
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
        const { id } = request.params;
        const { agentId } = request.body;

        await assignAgentToHost(id, agentId);

        sendUserListChanged();

        return { success: true, message: "Agent assigned to host" };
      } catch (error) {
        request.log.error(error, "Error in POST /hosts/:id/agents route");
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

  // DELETE /:id/agents/:agentId — Unassign agent from host
  fastify.delete<{
    Params: HostIdParams & { agentId: number };
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id/agents/:agentId",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Unassign an agent from this host",
        tags: ["Hosts"],
        params: HostIdParamsSchema.merge(AgentIdParamSchema),
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
        const { id, agentId } = request.params;

        await unassignAgentFromHost(id, agentId);

        sendUserListChanged();

        return { success: true, message: "Agent unassigned from host" };
      } catch (error) {
        request.log.error(
          error,
          "Error in DELETE /hosts/:id/agents/:agentId route",
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
