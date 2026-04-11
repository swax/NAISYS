import { createReadStream, existsSync, statSync } from "node:fs";
import fs from "node:fs/promises";

import type { HateoasAction } from "@naisys/common";
import type {
  AdminAttachmentListRequest,
  AdminAttachmentListResponse,
  AdminInfoResponse,
  ErrorResponse,
  ServerLogRequest,
  ServerLogResponse,
} from "@naisys/erp-shared";
import {
  AdminAttachmentListRequestSchema,
  AdminAttachmentListResponseSchema,
  AdminInfoResponseSchema,
  ErrorResponseSchema,
  ServerLogRequestSchema,
  ServerLogResponseSchema,
} from "@naisys/erp-shared";
import { getHubVariable } from "@naisys/hub-database";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod/v4";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { ERP_DB_VERSION, erpDbPath } from "../dbConfig.js";
import erpDb from "../erpDb.js";
import { notFound } from "../error-handler.js";
import { paginationLinks } from "../hateoas.js";
import { getErpLogPath, tailLogFile } from "../services/log-file-service.js";
import { getPackageVersion } from "../version.js";

const API_PREFIX = "/erp/api";

function adminActions(hasAdminPermission: boolean): HateoasAction[] {
  const actions: HateoasAction[] = [];

  if (hasAdminPermission) {
    actions.push({
      rel: "view-logs",
      href: `${API_PREFIX}/admin/logs`,
      method: "GET",
      title: "View Logs",
    });
    actions.push({
      rel: "view-attachments",
      href: `${API_PREFIX}/admin/attachments`,
      method: "GET",
      title: "View Attachments",
    });
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
      preHandler: [requirePermission("erp_admin")],
      schema: {
        description: "Get ERP admin system info",
        tags: ["Admin"],
        response: {
          200: AdminInfoResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, _reply) => {
      const hasAdminPerm = hasPermission(request.erpUser, "erp_admin");
      const actions = adminActions(hasAdminPerm);

      const dbPath = erpDbPath();
      const [erpDbSize, targetVersion] = await Promise.all([
        fs
          .stat(dbPath)
          .then((s) => s.size)
          .catch(() => undefined),
        getHubVariable("TARGET_VERSION"),
      ]);

      return {
        erpVersion: getPackageVersion(),
        erpDbPath: dbPath,
        erpDbSize,
        erpDbVersion: ERP_DB_VERSION,
        targetVersion: targetVersion || undefined,
        _actions: actions.length > 0 ? actions : undefined,
      };
    },
  );

  // GET /logs — Tail ERP log file
  fastify.get<{
    Querystring: ServerLogRequest;
    Reply: ServerLogResponse | ErrorResponse;
  }>(
    "/logs",
    {
      preHandler: [requirePermission("erp_admin")],
      schema: {
        description: "Get tail of the ERP server log file",
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
      const { lines, minLevel } = request.query;
      const cappedLines = Math.min(lines, 1000);
      const filePath = getErpLogPath();
      const { entries, fileSize } = await tailLogFile(
        filePath,
        cappedLines,
        minLevel,
      );
      return {
        entries,
        fileName: "erp.log",
        fileSize,
      };
    },
  );

  // GET /attachments — List all attachments
  fastify.get<{
    Querystring: AdminAttachmentListRequest;
    Reply: AdminAttachmentListResponse | ErrorResponse;
  }>(
    "/attachments",
    {
      preHandler: [requirePermission("erp_admin")],
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
        erpDb.attachment.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            uploadedBy: { select: { username: true } },
          },
          skip,
          take: pageSize,
        }),
        erpDb.attachment.count(),
      ]);

      return {
        attachments: rows.map((r) => ({
          id: r.publicId,
          filename: r.filename,
          fileSize: r.fileSize,
          fileHash: r.fileHash,
          uploadedBy: r.uploadedBy.username,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        _links: paginationLinks("admin/attachments", page, pageSize, total),
      };
    },
  );

  // GET /attachments/:id — Download an attachment by ID
  fastify.get<{
    Params: { id: string };
  }>(
    "/attachments/:id",
    {
      preHandler: [requirePermission("erp_admin")],
      schema: {
        description: "Download an attachment file by ID",
        tags: ["Admin"],
        params: z.object({ id: z.string() }),
      },
    },
    async (request, reply) => {
      const att = await erpDb.attachment.findUnique({
        where: { publicId: request.params.id },
        select: { filepath: true, filename: true, fileSize: true },
      });

      if (!att) return notFound(reply, "Attachment not found");
      if (!existsSync(att.filepath))
        return notFound(reply, "Attachment file missing from disk");

      const stat = statSync(att.filepath);
      reply.header("content-type", "application/octet-stream");
      reply.header(
        "content-disposition",
        `attachment; filename="${att.filename.replace(/"/g, '\\"')}"`,
      );
      reply.header("content-length", stat.size);
      return reply.send(createReadStream(att.filepath));
    },
  );
}
