import type { HateoasLink } from "@naisys/common";
import { PermissionEnum } from "@naisys-supervisor/shared";
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
        { rel: "agents", href: `${API_PREFIX}/agents`, title: "Agents" },
        { rel: "hosts", href: `${API_PREFIX}/hosts`, title: "Hosts" },
        { rel: "models", href: `${API_PREFIX}/models`, title: "Models" },
        {
          rel: "variables",
          href: `${API_PREFIX}/variables`,
          title: "Variables",
        },
        {
          rel: "permissions",
          href: `${API_PREFIX}/permissions`,
          title: "Available Permissions",
        },
      ];

      // Only show user management links if user has supervisor_admin permission
      if (request.supervisorUser?.permissions.includes("supervisor_admin")) {
        links.push({
          rel: "users",
          href: `${API_PREFIX}/users`,
          title: "User Management",
        });
        links.push({
          rel: "admin",
          href: `${API_PREFIX}/admin`,
          title: "Admin",
        });
      }

      return { _links: links };
    },
  );

  fastify.get(
    "/permissions",
    {
      schema: {
        description: "List all available permissions",
        tags: ["Discovery"],
      },
    },
    async () => {
      return { permissions: PermissionEnum.options };
    },
  );
}
