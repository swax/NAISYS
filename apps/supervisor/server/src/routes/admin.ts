import {
  AdminInfoResponse,
  AdminInfoResponseSchema,
  ErrorResponse,
  ErrorResponseSchema,
} from "@naisys-supervisor/shared";
import type { HateoasAction, ModelDbRow } from "@naisys/common";
import archiver from "archiver";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { supervisorDbPath } from "../dbConfig.js";
import { getNaisysDatabasePath, usingNaisysDb } from "../database/naisysDatabase.js";
import { API_PREFIX } from "../hateoas.js";
import { isHubConnected } from "../services/hubConnectionService.js";
import {
  buildExportFiles,
  type ExportUserRow,
} from "../services/configExportService.js";

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
      const users = await usingNaisysDb((prisma) =>
        prisma.users.findMany({
          select: {
            id: true,
            username: true,
            title: true,
            config: true,
            lead_user_id: true,
            archived: true,
          },
        }),
      ) as ExportUserRow[];

      const variables = await usingNaisysDb((prisma) =>
        prisma.variables.findMany({
          select: { key: true, value: true },
          orderBy: { key: "asc" },
        }),
      );

      const modelRows = await usingNaisysDb((prisma) =>
        prisma.models.findMany(),
      ) as ModelDbRow[];

      const exportFiles = buildExportFiles(users, variables, modelRows);

      reply.header(
        "Content-Disposition",
        'attachment; filename="naisys-config.zip"',
      );
      reply.type("application/zip");

      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.on("error", (err) => {
        reply.log.error(err, "Archiver error");
      });

      for (const file of exportFiles) {
        archive.append(file.content, { name: file.path });
      }

      await archive.finalize();

      return reply.send(archive);
    },
  );
}
