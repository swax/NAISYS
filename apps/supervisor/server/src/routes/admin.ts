import {
  AdminInfoResponse,
  AdminInfoResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
} from "@naisys-supervisor/shared";
import type { HateoasAction } from "@naisys/common";
import archiver from "archiver";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { supervisorDbPath } from "../dbConfig.js";
import { getNaisysDatabasePath } from "../database/naisysDatabase.js";
import { API_PREFIX } from "../hateoas.js";
import { isHubConnected } from "../services/hubConnectionService.js";

function adminActions(hasAdminPermission: boolean): HateoasAction[] {
  const actions: HateoasAction[] = [];

  if (hasAdminPermission) {
    actions.push({
      rel: "export-config",
      href: `${API_PREFIX}/admin/export-config`,
      method: "GET",
      title: "Export Config",
    });
  }

  return actions;
}

export default async function adminRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET / — Admin info
  fastify.get<{
    Reply: AdminInfoResponse | ErrorResponse;
  }>(
    "/",
    {
      preHandler: [requirePermission("supervisor_admin")],
      schema: {
        description: "Get admin system info",
        tags: ["Admin"],
        response: {
          200: AdminInfoResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const hasAdminPermission = hasPermission(
          request.supervisorUser,
          "supervisor_admin",
        );

        const actions = adminActions(hasAdminPermission);

        return {
          supervisorDbPath: supervisorDbPath(),
          hubDbPath: getNaisysDatabasePath(),
          hubConnected: isHubConnected(),
          _actions: actions.length > 0 ? actions : undefined,
        };
      } catch (error) {
        reply.log.error(error, "Error in GET /admin route");
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching admin info",
        });
      }
    },
  );

  // GET /export-config — Download config zip
  fastify.get(
    "/export-config",
    {
      preHandler: [requirePermission("supervisor_admin")],
      schema: {
        description: "Export configuration as a zip file",
        tags: ["Admin"],
        security: [{ cookieAuth: [] }],
      },
    },
    async (_request, reply) => {
      reply.header(
        "Content-Disposition",
        'attachment; filename="naisys-config.zip"',
      );
      reply.type("application/zip");

      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.on("error", (err) => {
        reply.log.error(err, "Archiver error");
      });

      archive.append("Hello from NAISYS!", { name: "hello.txt" });
      await archive.finalize();

      return reply.send(archive);
    },
  );
}
