import type { HateoasLink, SupervisorPlugin } from "@naisys/common";
import { PermissionEnum } from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

const API_PREFIX = "/supervisor/api";

interface RootRoutesOptions extends FastifyPluginOptions {
  plugins?: SupervisorPlugin[];
}

export default function rootRoutes(
  fastify: FastifyInstance,
  options: RootRoutesOptions,
) {
  fastify.get(
    "/",
    {
      schema: {
        description: "API discovery root",
        tags: ["Discovery"],
      },
    },
    (request) => {
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

      if (options.plugins?.includes("erp")) {
        links.push({ rel: "erp", href: "/erp/api/", title: "ERP" });
      }

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
    () => {
      return { permissions: PermissionEnum.options };
    },
  );
}
