import type { HateoasAction, HateoasActionTemplate } from "@naisys/common";
import type {
  AgentActionResult,
  AssignAgentToHostRequest,
  CreateHostRequest,
  ErrorResponse,
  HostAccessKeyResult,
  HostDetailResponse,
  HostListResponse,
  HostNameParams,
  RunsDataRequest,
  RunsDataResponse,
  UpdateHostRequest,
} from "@naisys/supervisor-shared";
import {
  AgentActionResultSchema,
  AgentNameParamSchema,
  AssignAgentToHostRequestSchema,
  CreateHostRequestSchema,
  ErrorResponseSchema,
  HostAccessKeyResultSchema,
  HostDetailResponseSchema,
  HostListResponseSchema,
  HostNameParamsSchema,
  RunsDataRequestSchema,
  RunsDataResponseSchema,
  UpdateHostRequestSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import type { SupervisorUser } from "../../authMiddleware.js";
import { hasPermission, requirePermission } from "../../authMiddleware.js";
import { hubDb } from "../../database/hubDb.js";
import { badRequest, conflict, notFound } from "../../errorHelpers.js";
import { API_PREFIX, selfLink, timestampCursorLinks } from "../../hateoas.js";
import {
  permGate,
  resolveActions,
  resolveActionTemplates,
} from "../../routeHelpers.js";
import {
  emitHostsListChanged,
  getHostVersion,
  isHostConnected,
} from "../../services/agents/agentHostStatusService.js";
import {
  sendHostsChanged,
  sendHostTerminate,
  sendUserListChanged,
} from "../../services/comms/hubConnectionService.js";
import {
  assignAgentToHost,
  createHost,
  deleteHost,
  getHostDetail,
  getHosts,
  rotateHostAccessKey,
  unassignAgentFromHost,
  updateHost,
} from "../../services/hostService.js";
import { getRunsData } from "../../services/observability/runsService.js";

type HostCtx = {
  user: SupervisorUser | undefined;
  isOnline: boolean;
  hostType: string;
};

function hostActions(
  hostname: string,
  user: SupervisorUser | undefined,
  isOnline: boolean,
  hostType: string,
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
      ...(hostType !== "supervisor"
        ? [
            {
              rel: "rotate-access-key" as const,
              path: "/rotate-access-key",
              method: "POST" as const,
              title: "Rotate Access Key",
              permission: "manage_hosts" as const,
            },
            {
              rel: "assign-agent" as const,
              path: "/agents",
              method: "POST" as const,
              title: "Assign Agent",
              permission: "manage_hosts" as const,
            },
            {
              rel: "terminate" as const,
              path: "/terminate",
              method: "POST" as const,
              title: "Terminate NAISYS on Host",
              permission: "manage_hosts" as const,
              disabledWhen: (ctx: HostCtx) =>
                ctx.isOnline ? null : "Host is offline",
            },
          ]
        : []),
      {
        rel: "delete",
        method: "DELETE",
        title: "Delete Host",
        permission: "manage_hosts",
        disabledWhen: (ctx: HostCtx) => {
          if (ctx.hostType === "supervisor") {
            return "Supervisor host is bootstrap-managed";
          }
          return ctx.isOnline ? "Host must be offline before deletion" : null;
        },
      },
    ],
    href,
    { user, isOnline, hostType },
  );
}

function hostActionTemplates(
  hostname: string,
  user: SupervisorUser | undefined,
  hostType: string,
): HateoasActionTemplate[] {
  // Supervisor hosts can't have agents unassigned — hide entirely (state guard)
  if (hostType === "supervisor") return [];
  return resolveActionTemplates(
    [
      {
        rel: "unassignAgent",
        path: "/agents/{agentName}",
        method: "DELETE",
        title: "Unassign Agent",
        permission: "manage_hosts",
      },
    ],
    `${API_PREFIX}/hosts/${hostname}`,
    { user },
  );
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
      const [hosts, targetVar] = await Promise.all([
        getHosts(),
        hubDb.variables.findUnique({ where: { key: "TARGET_VERSION" } }),
      ]);

      const user = request.supervisorUser;
      const hasManageHostsPermission = hasPermission(user, "manage_hosts");

      const items = hosts.map((host) => {
        const online = isHostConnected(host.id);
        return {
          ...host,
          online,
          version: getHostVersion(host.id) || host.lastVersion,
          _actions: hostActions(host.name, user, online, host.hostType),
        };
      });

      return {
        items,
        targetVersion: targetVar?.value || undefined,
        _links: [selfLink("/hosts")],
        _linkTemplates: [
          { rel: "item", hrefTemplate: `${API_PREFIX}/hosts/{name}` },
        ],
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
    Reply: HostAccessKeyResult | ErrorResponse;
  }>(
    "/",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Create a new host and return its plaintext access key",
        tags: ["Hosts"],
        body: CreateHostRequestSchema,
        response: {
          200: HostAccessKeyResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { name } = request.body;
        const { accessKey } = await createHost(name);

        sendHostsChanged();

        return {
          success: true,
          message: `Host '${name}' created. Set HOST_ACCESS_KEY on the NAISYS host with the key below — it will not be shown again.`,
          accessKey,
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

  // POST /:hostname/rotate-access-key — Generate a fresh access key for a host
  fastify.post<{
    Params: HostNameParams;
    Reply: HostAccessKeyResult | ErrorResponse;
  }>(
    "/:hostname/rotate-access-key",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description:
          "Rotate the host's access key. The previous key is rejected on future connections.",
        tags: ["Hosts"],
        params: HostNameParamsSchema,
        response: {
          200: HostAccessKeyResultSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { hostname } = request.params;
      const host = await getHostDetail(hostname);
      if (!host) {
        return notFound(reply, `Host "${hostname}" not found`);
      }
      if (host.hostType === "supervisor") {
        return badRequest(
          reply,
          "Cannot rotate the supervisor host's access key from the UI — it is bootstrap-managed.",
        );
      }

      const { accessKey } = await rotateHostAccessKey(hostname);
      sendHostsChanged();

      return {
        success: true,
        message: `Access key rotated for "${hostname}". Update HOST_ACCESS_KEY before the NAISYS host reconnects; current connections are not disconnected automatically.`,
        accessKey,
      };
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
      const online = isHostConnected(host.id);

      return {
        ...host,
        online,
        version: getHostVersion(host.id) || host.lastVersion,
        assignedAgents: host.assignedAgents,
        _links: [selfLink(`/hosts/${hostname}`)],
        _actions: hostActions(hostname, user, online, host.hostType),
        _actionTemplates: hostActionTemplates(hostname, user, host.hostType),
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

        const host = await getHostDetail(hostname);
        if (!host) {
          return notFound(reply, `Host "${hostname}" not found`);
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

      if (host.hostType === "supervisor") {
        return badRequest(
          reply,
          "Cannot delete the supervisor host — it is bootstrap-managed.",
        );
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

  // POST /:hostname/terminate — Terminate the NAISYS client process on a host
  fastify.post<{
    Params: HostNameParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:hostname/terminate",
    {
      preHandler: [requirePermission("manage_hosts")],
      schema: {
        description: "Terminate the NAISYS client process running on a host",
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

      const host = await getHostDetail(hostname);
      if (!host) {
        return notFound(reply, `Host "${hostname}" not found`);
      }
      if (host.hostType === "supervisor") {
        return badRequest(reply, "Cannot terminate the supervisor host");
      }
      if (!isHostConnected(host.id)) {
        return badRequest(reply, "Host is offline — nothing to terminate");
      }

      try {
        const result = await sendHostTerminate(host.id);
        if (!result.success) {
          return badRequest(
            reply,
            result.error || "Failed to terminate host client",
          );
        }
        return {
          success: true,
          message: `Termination request sent to "${hostname}"`,
        };
      } catch (error) {
        return badRequest(
          reply,
          error instanceof Error ? error.message : "Unknown error",
        );
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
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        if (errorMessage.includes("not found")) {
          return notFound(reply, errorMessage);
        }
        if (errorMessage.includes("already assigned")) {
          return conflict(reply, errorMessage);
        }
        if (errorMessage.includes("Cannot assign")) {
          return badRequest(reply, errorMessage);
        }

        throw error;
      }
    },
  );

  // GET /:hostname/runs — Runs that ran on this host
  fastify.get<{
    Params: HostNameParams;
    Querystring: RunsDataRequest;
    Reply: RunsDataResponse | ErrorResponse;
  }>(
    "/:hostname/runs",
    {
      schema: {
        description: "Get run sessions that ran on a specific host",
        tags: ["Hosts"],
        params: HostNameParamsSchema,
        querystring: RunsDataRequestSchema,
        response: {
          200: RunsDataResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { hostname } = request.params;
      const { updatedSince, updatedBefore, page, count } = request.query;

      const host = await getHostDetail(hostname);
      if (!host) {
        return notFound(reply, `Host "${hostname}" not found`);
      }

      const data = await getRunsData(
        { hostName: hostname },
        updatedSince,
        updatedBefore,
        page,
        count,
      );

      const oldest = data.runs.length
        ? data.runs[data.runs.length - 1].lastActive
        : undefined;

      return {
        success: true,
        message: "Host runs retrieved successfully",
        data,
        _links: timestampCursorLinks(
          `/hosts/${hostname}/runs`,
          data.timestamp,
          oldest,
        ),
      };
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
