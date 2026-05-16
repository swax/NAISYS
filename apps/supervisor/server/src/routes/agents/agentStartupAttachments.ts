import type { MultipartFile, MultipartValue } from "@fastify/multipart";
import type {
  AgentActionResult,
  AgentUsernameParams,
  ErrorResponse,
  StartupAttachmentListResponse,
  StartupAttachmentResponse,
  UpdateStartupAttachmentRequest,
} from "@naisys/supervisor-shared";
import {
  AgentActionResultSchema,
  AgentUsernameParamsSchema,
  ErrorResponseSchema,
  StartupAttachmentListResponseSchema,
  StartupAttachmentResponseSchema,
  UpdateStartupAttachmentRequestSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";

import { hasPermission, requirePermission } from "../../auth-middleware.js";
import { badRequest, notFound } from "../../error-helpers.js";
import { API_PREFIX } from "../../hateoas.js";
import { resolveAgentId } from "../../services/agents/agentService.js";
import {
  addStartupAttachment,
  deleteStartupAttachment,
  listStartupAttachments,
  updateStartupAttachmentPath,
} from "../../services/agents/userStartupAttachmentsService.js";

const DeleteQuerySchema = z.object({ path: z.string().min(1) });

export default function agentStartupAttachmentsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:username/startup-attachments — list
  fastify.get<{
    Params: AgentUsernameParams;
    Reply: StartupAttachmentListResponse | ErrorResponse;
  }>(
    "/:username/startup-attachments",
    {
      schema: {
        description: "List startup attachments for an agent",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        response: {
          200: StartupAttachmentListResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const id = resolveAgentId(username);
      if (!id) return notFound(reply, `Agent '${username}' not found`);

      const rawItems = await listStartupAttachments(id);
      const canManage = hasPermission(request.supervisorUser, "manage_agents");
      const collectionHref = `${API_PREFIX}/agents/${username}/startup-attachments`;

      const items = rawItems.map((item) => {
        const itemHref = `${collectionHref}?path=${encodeURIComponent(item.path)}`;
        return {
          ...item,
          _actions: canManage
            ? [
                {
                  rel: "update",
                  href: itemHref,
                  method: "PUT" as const,
                  title: "Rename Startup Attachment",
                  schema: `${API_PREFIX}/schemas/UpdateStartupAttachment`,
                  body: { newPath: "" },
                },
                {
                  rel: "delete",
                  href: itemHref,
                  method: "DELETE" as const,
                  title: "Delete Startup Attachment",
                },
              ]
            : undefined,
        };
      });

      return {
        items,
        _actions: canManage
          ? [
              {
                rel: "add",
                href: collectionHref,
                method: "POST" as const,
                title: "Add Startup Attachment",
                alternateEncoding: {
                  contentType: "multipart/form-data",
                  description: "Upload file with target path",
                  fileFields: ["file"],
                },
              },
            ]
          : undefined,
      };
    },
  );

  // POST /:username/startup-attachments — upload (multipart: file + path)
  fastify.post<{
    Params: AgentUsernameParams;
    Reply: StartupAttachmentResponse | ErrorResponse;
  }>(
    "/:username/startup-attachments",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description:
          "Upload a startup attachment (multipart/form-data with 'file' and 'path' fields)",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        response: {
          200: StartupAttachmentResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const id = resolveAgentId(username);
      if (!id) return notFound(reply, `Agent '${username}' not found`);

      const contentType = request.headers["content-type"];
      if (!contentType?.includes("multipart/form-data")) {
        return badRequest(reply, "Expected multipart/form-data");
      }

      let path = "";
      let file: { buffer: Buffer; filename: string } | null = null;

      for await (const part of request.parts()) {
        if (part.type === "field" && part.fieldname === "path") {
          path = String((part as MultipartValue<string>).value);
        } else if (part.type === "file" && part.fieldname === "file") {
          const f = part as MultipartFile;
          file = {
            buffer: await f.toBuffer(),
            filename: f.filename || "unnamed",
          };
        }
      }

      if (!file) return badRequest(reply, "Missing 'file' field");
      if (!path.trim()) path = file.filename;

      try {
        const item = await addStartupAttachment(
          id,
          file.buffer,
          file.filename,
          path,
        );
        return { success: true, item };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        return badRequest(reply, message);
      }
    },
  );

  // PUT /:username/startup-attachments?path=oldPath — rename
  fastify.put<{
    Params: AgentUsernameParams;
    Querystring: { path: string };
    Body: UpdateStartupAttachmentRequest;
    Reply: StartupAttachmentResponse | ErrorResponse;
  }>(
    "/:username/startup-attachments",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description:
          "Rename a startup attachment by changing its relative path",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        querystring: DeleteQuerySchema,
        body: UpdateStartupAttachmentRequestSchema,
        response: {
          200: StartupAttachmentResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const id = resolveAgentId(username);
      if (!id) return notFound(reply, `Agent '${username}' not found`);

      const { path: oldPath } = request.query;
      const { newPath } = request.body;

      try {
        const item = await updateStartupAttachmentPath(id, oldPath, newPath);
        return { success: true, item };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to rename attachment";
        if (message.includes("No startup attachment")) {
          return notFound(reply, message);
        }
        return badRequest(reply, message);
      }
    },
  );

  // DELETE /:username/startup-attachments?path=... — remove
  fastify.delete<{
    Params: AgentUsernameParams;
    Querystring: { path: string };
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:username/startup-attachments",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Remove a startup attachment by path",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        querystring: DeleteQuerySchema,
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
      const { username } = request.params;
      const id = resolveAgentId(username);
      if (!id) return notFound(reply, `Agent '${username}' not found`);

      const { path } = request.query;
      try {
        await deleteStartupAttachment(id, path);
        return { success: true, message: "Startup attachment removed" };
      } catch {
        return notFound(reply, `No startup attachment at path '${path}'`);
      }
    },
  );
}
