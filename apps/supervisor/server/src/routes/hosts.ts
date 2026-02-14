import {
  ErrorResponse,
  ErrorResponseSchema,
  HostListResponse,
  HostListResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { selfLink } from "../hateoas.js";
import { getHosts } from "../services/agentService.js";

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
    async (_request, reply) => {
      try {
        const hosts = await getHosts();

        const items = hosts.map((host) => ({
          ...host,
          _links: [selfLink(`/hosts/${host.name}`)],
        }));

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
}
