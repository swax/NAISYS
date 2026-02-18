import {
  AgentActionResult,
  AgentActionResultSchema,
  ErrorResponse,
  ErrorResponseSchema,
  HostIdParams,
  HostIdParamsSchema,
  HostListResponse,
  HostListResponseSchema,
} from "@naisys-supervisor/shared";
import type { HateoasAction } from "@naisys/common";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { requirePermission } from "../auth-middleware.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import { deleteHost, getHosts } from "../services/agentService.js";
import { isHostConnected } from "../services/agentHostStatusService.js";

function hostActions(
  hostId: number,
  hasManagePermission: boolean,
  isOnline: boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];

  if (hasManagePermission && !isOnline) {
    actions.push({
      rel: "delete",
      href: `${API_PREFIX}/hosts/${hostId}`,
      method: "DELETE",
      title: "Delete Host",
    });
  }

  return actions;
}

export default async function hostsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
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

        const hasManagePermission =
          request.supervisorUser?.permissions.includes("manage_agents") ??
          false;

        const items = hosts.map((host) => {
          const online = isHostConnected(host.id);
          const actions = hostActions(host.id, hasManagePermission, online);
          return {
            ...host,
            online,
            _links: [selfLink(`/hosts/${host.id}`)],
            _actions: actions.length > 0 ? actions : undefined,
          };
        });

        return {
          items,
          _links: [selfLink("/hosts")],
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

  // DELETE /:id — Permanently delete a host
  fastify.delete<{
    Params: HostIdParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Permanently delete an offline host with no agents",
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
}
