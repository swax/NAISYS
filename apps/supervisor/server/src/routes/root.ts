import type { HateoasLink } from "@naisys/common";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

const API_PREFIX = "/api/supervisor";

export default async function rootRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get(
    "/",
    {
      schema: {
        description: "API discovery root",
        tags: ["Discovery"],
      },
    },
    async (request) => {
      const links: HateoasLink[] = [
        { rel: "self", href: `${API_PREFIX}/` },
        {
          rel: "auth-me",
          href: `${API_PREFIX}/auth/me`,
          title: "Current User",
        },
        { rel: "schemas", href: `${API_PREFIX}/schemas/`, title: "Schemas" },
      ];

      // Only show user management links if user has supervisor_admin permission
      if (request.supervisorUser?.permissions.includes("supervisor_admin")) {
        links.push({
          rel: "users",
          href: `${API_PREFIX}/users`,
          title: "User Management",
        });
      }

      return { _links: links };
    },
  );
}
