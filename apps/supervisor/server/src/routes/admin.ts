import fs from "node:fs/promises";

import type { HateoasAction, ModelDbRow } from "@naisys/common";
import { HUB_DB_VERSION } from "@naisys/hub-database";
import {
  SUPERVISOR_DB_VERSION,
  supervisorDbPath,
} from "@naisys/supervisor-database";
import type {
  AdminAttachmentListRequest,
  AdminAttachmentListResponse,
  AdminInfoResponse,
  ErrorResponse,
  NpmVersionsRequest,
  NpmVersionsResponse,
  RotateAccessKeyResult,
  SaveVariableResponse,
  ServerLogRequest,
  ServerLogResponse,
  SetTargetVersionRequest,
} from "@naisys/supervisor-shared";
import {
  AdminAttachmentListRequestSchema,
  AdminAttachmentListResponseSchema,
  AdminInfoResponseSchema,
  ErrorResponseSchema,
  NpmVersionsRequestSchema,
  NpmVersionsResponseSchema,
  RotateAccessKeyResultSchema,
  SaveVariableResponseSchema,
  ServerLogRequestSchema,
  ServerLogResponseSchema,
  SetTargetVersionRequestSchema,
} from "@naisys/supervisor-shared";
import archiver from "archiver";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { getNaisysDatabasePath, hubDb } from "../database/hubDb.js";
import { API_PREFIX, paginationLinks } from "../hateoas.js";
import {
  buildExportFiles,
  type ExportUserRow,
} from "../services/configExportService.js";
import {
  getHubAccessKey,
  getHubVersion,
  isHubConnected,
  sendRotateAccessKey,
  sendVariablesChanged,
} from "../services/hubConnectionService.js";
import { getLogFilePath, tailLogFile } from "../services/logFileService.js";
import { saveVariable } from "../services/variableService.js";
import { getPackageVersion } from "../version.js";

function adminActions(hasAdminPermission: boolean): HateoasAction[] {
  const actions: HateoasAction[] = [];

  if (hasAdminPermission) {
    actions.push(
      {
        rel: "export-config",
        href: `${API_PREFIX}/admin/export-config`,
        method: "GET",
        title: "Export Config",
      },
      {
        rel: "view-logs",
        href: `${API_PREFIX}/admin/logs`,
        method: "GET",
        title: "View Logs",
      },
      {
        rel: "view-attachments",
        href: `${API_PREFIX}/admin/attachments`,
        method: "GET",
        title: "View Attachments",
      },
    );

    actions.push(
      {
        rel: "check-updates",
        href: `${API_PREFIX}/admin/npm-versions`,
        method: "GET",
        title: "Check for Updates",
      },
      {
        rel: "set-target-version",
        href: `${API_PREFIX}/admin/target-version`,
        method: "PUT",
        title: "Set Target Version",
      },
    );

    if (getHubAccessKey()) {
      actions.push({
        rel: "rotate-access-key",
        href: `${API_PREFIX}/admin/rotate-access-key`,
        method: "POST",
        title: "Rotate Hub Access Key",
      });
    }
  }

  return actions;
}

export default function adminRoutes(
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
    async (request, _reply) => {
      const hasAdminPermission = hasPermission(
        request.supervisorUser,
        "supervisor_admin",
      );

      const actions = adminActions(hasAdminPermission);

      const [supervisorDbSize, hubDbSize, targetVar] = await Promise.all([
        fs
          .stat(supervisorDbPath())
          .then((s) => s.size)
          .catch(() => undefined),
        fs
          .stat(getNaisysDatabasePath())
          .then((s) => s.size)
          .catch(() => undefined),
        hubDb.variables.findUnique({ where: { key: "TARGET_VERSION" } }),
      ]);

      return {
        supervisorVersion: getPackageVersion(),
        supervisorDbPath: supervisorDbPath(),
        supervisorDbSize,
        supervisorDbVersion: SUPERVISOR_DB_VERSION,
        hubVersion: getHubVersion(),
        hubDbPath: getNaisysDatabasePath(),
        hubDbSize,
        hubDbVersion: HUB_DB_VERSION,
        hubConnected: isHubConnected(),
        hubAccessKey: getHubAccessKey(),
        targetVersion: targetVar?.value || undefined,
        _actions: actions.length > 0 ? actions : undefined,
      };
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
      const users = (await hubDb.users.findMany({
        select: {
          id: true,
          username: true,
          title: true,
          config: true,
          lead_user_id: true,
          archived: true,
        },
      })) as ExportUserRow[];

      const variables = await hubDb.variables.findMany({
        select: { key: true, value: true },
        orderBy: { key: "asc" },
      });

      const modelRows = (await hubDb.models.findMany()) as ModelDbRow[];

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

  // POST /rotate-access-key — Rotate hub access key
  fastify.post<{
    Reply: RotateAccessKeyResult | ErrorResponse;
  }>(
    "/rotate-access-key",
    {
      preHandler: [requirePermission("supervisor_admin")],
      schema: {
        description: "Rotate the hub access key",
        tags: ["Admin"],
        response: {
          200: RotateAccessKeyResultSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (_request, reply) => {
      try {
        const result = await sendRotateAccessKey();
        return result;
      } catch (error) {
        reply.log.error(error, "Error in POST /admin/rotate-access-key route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Failed to rotate access key",
        });
      }
    },
  );

  // GET /logs — Tail server log files
  fastify.get<{
    Querystring: ServerLogRequest;
    Reply: ServerLogResponse | ErrorResponse;
  }>(
    "/logs",
    {
      preHandler: [requirePermission("supervisor_admin")],
      schema: {
        description: "Get tail of a server log file",
        tags: ["Admin"],
        querystring: ServerLogRequestSchema,
        response: {
          200: ServerLogResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, _reply) => {
      const { file, lines, minLevel } = request.query;
      const cappedLines = Math.min(lines, 1000);
      const filePath = getLogFilePath(file);
      const { entries, fileSize } = await tailLogFile(
        filePath,
        cappedLines,
        minLevel,
      );
      return {
        entries,
        fileName: `${file}.log`,
        fileSize,
      };
    },
  );

  // GET /npm-versions — Check npm registry for latest versions
  fastify.get<{
    Querystring: NpmVersionsRequest;
    Reply: NpmVersionsResponse | ErrorResponse;
  }>(
    "/npm-versions",
    {
      preHandler: [requirePermission("supervisor_admin")],
      schema: {
        description: "Fetch latest naisys versions from npm registry",
        tags: ["Admin"],
        querystring: NpmVersionsRequestSchema,
        response: {
          200: NpmVersionsResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        // Fetch dist-tags from npm
        const distTagsRes = await fetch(
          "https://registry.npmjs.org/-/package/naisys/dist-tags",
        );
        if (!distTagsRes.ok) {
          return reply.status(500).send({
            success: false,
            message: `npm registry returned ${distTagsRes.status}`,
          });
        }
        const distTags = (await distTagsRes.json()) as Record<string, string>;

        // Read current TARGET_VERSION from DB
        const targetVar = await hubDb.variables.findUnique({
          where: { key: "TARGET_VERSION" },
        });

        const result: NpmVersionsResponse = {
          latest: distTags.latest ?? "",
          beta: distTags.beta ?? null,
          targetVersion: targetVar?.value ?? "",
        };

        // Optionally validate a specific version
        const { check } = request.query;
        if (check) {
          const checkRes = await fetch(
            `https://registry.npmjs.org/naisys/${encodeURIComponent(check)}`,
          );
          result.check = {
            version: check,
            exists: checkRes.ok,
          };
        }

        return result;
      } catch (error) {
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Failed to check npm registry",
        });
      }
    },
  );

  // PUT /target-version — Set the TARGET_VERSION variable
  fastify.put<{
    Body: SetTargetVersionRequest;
    Reply: SaveVariableResponse | ErrorResponse;
  }>(
    "/target-version",
    {
      preHandler: [requirePermission("supervisor_admin")],
      schema: {
        description: "Set the TARGET_VERSION variable for auto-updates",
        tags: ["Admin"],
        body: SetTargetVersionRequestSchema,
        response: {
          200: SaveVariableResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { version } = request.body;
        const result = await saveVariable(
          "TARGET_VERSION",
          version,
          false,
          false,
          request.supervisorUser!.uuid,
        );
        sendVariablesChanged();
        return result;
      } catch (error) {
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Failed to set target version",
        });
      }
    },
  );

  // GET /attachments — List all attachments
  fastify.get<{
    Querystring: AdminAttachmentListRequest;
    Reply: AdminAttachmentListResponse | ErrorResponse;
  }>(
    "/attachments",
    {
      preHandler: [requirePermission("supervisor_admin")],
      schema: {
        description: "List all uploaded attachments",
        tags: ["Admin"],
        querystring: AdminAttachmentListRequestSchema,
        response: {
          200: AdminAttachmentListResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, _reply) => {
      const { page, pageSize } = request.query;
      const skip = (page - 1) * pageSize;

      const [rows, total] = await Promise.all([
        hubDb.attachments.findMany({
          orderBy: { created_at: "desc" },
          include: {
            uploader: { select: { username: true } },
          },
          skip,
          take: pageSize,
        }),
        hubDb.attachments.count(),
      ]);

      return {
        attachments: rows.map((r) => ({
          id: r.public_id,
          filename: r.filename,
          fileSize: r.file_size,
          fileHash: r.file_hash,
          purpose: r.purpose,
          uploadedBy: r.uploader.username,
          createdAt: r.created_at.toISOString(),
        })),
        total,
        page,
        pageSize,
        _links: paginationLinks("admin/attachments", page, pageSize, total),
      };
    },
  );
}
