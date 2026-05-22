import type { MultipartFile, MultipartValue } from "@fastify/multipart";
import type { AlternateEncoding, HateoasAction } from "@naisys/common";
import type {
  AgentActionResult,
  AgentUsernameParams,
  ErrorResponse,
  StartupAttachment,
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

import type { SupervisorUser } from "../../authMiddleware.js";
import { requirePermission } from "../../authMiddleware.js";
import { badRequest, notFound } from "../../errorHelpers.js";
import { API_PREFIX, schemaLink, selfLink } from "../../hateoas.js";
import type { ActionDef } from "../../routeHelpers.js";
import { resolveActions, resolveActionTemplates } from "../../routeHelpers.js";
import { resolveAgentId } from "../../services/agents/agentService.js";
import {
  addStartupAttachment,
  deleteStartupAttachment,
  listStartupAttachments,
  replaceStartupAttachmentContent,
  updateStartupAttachmentPath,
} from "../../services/agents/userStartupAttachmentsService.js";

const PathQuerySchema = z.object({ path: z.string().min(1) });

/** Resolver context — only the permission gate (`user`) is consulted here. */
type AttachmentCtx = { user: SupervisorUser | undefined };

const ADD_FILE_ENCODING: AlternateEncoding = {
  contentType: "multipart/form-data",
  description: "Upload the file in the 'file' field with its target 'path'",
  fileFields: ["file"],
};

const REPLACE_FILE_ENCODING: AlternateEncoding = {
  contentType: "multipart/form-data",
  description: "Upload the replacement file in the 'file' field",
  fileFields: ["file"],
};

/** The collection-level `add` action. */
const ADD_DEF: ActionDef<AttachmentCtx> = {
  rel: "add",
  method: "POST",
  title: "Add Startup Attachment",
  alternateEncoding: ADD_FILE_ENCODING,
  permission: "manage_agents",
};

/**
 * Path-keyed operations on a single startup attachment, written in templated
 * form (`{path}` placeholder). Emitted verbatim as `_actionTemplates` and, with
 * the placeholder filled, as concrete per-item `_actions` — so update / replace
 * / delete stay discoverable even when the collection is empty.
 */
const ITEM_OP_DEFS: ActionDef<AttachmentCtx>[] = [
  {
    rel: "update",
    path: "?path={path}",
    method: "PUT",
    title: "Rename Startup Attachment",
    schema: `${API_PREFIX}/schemas/UpdateStartupAttachment`,
    body: { newPath: "" },
    permission: "manage_agents",
  },
  {
    rel: "replace-content",
    path: "/content?path={path}",
    method: "PUT",
    title: "Replace Startup Attachment Content",
    alternateEncoding: REPLACE_FILE_ENCODING,
    permission: "manage_agents",
  },
  {
    rel: "delete",
    path: "?path={path}",
    method: "DELETE",
    title: "Delete Startup Attachment",
    permission: "manage_agents",
  },
];

function collectionHref(username: string): string {
  return `${API_PREFIX}/agents/${username}/startup-attachments`;
}

/** Concrete per-item actions for an attachment at a known path. */
function itemActions(
  username: string,
  path: string,
  user: SupervisorUser | undefined,
): HateoasAction[] {
  const encoded = encodeURIComponent(path);
  return resolveActions<AttachmentCtx>(
    ITEM_OP_DEFS.map((def) => ({
      ...def,
      path: (def.path ?? "").replace("{path}", encoded),
    })),
    collectionHref(username),
    { user },
  );
}

/**
 * Collection-level hypermedia: self/schema links, an `item` link template, the
 * `add` action, and templated update/replace/delete actions. Actions are always
 * present — gated with `disabled`/`disabledReason` rather than omitted — so the
 * full route surface is discoverable regardless of permissions.
 */
function discoveryBlock(username: string, user: SupervisorUser | undefined) {
  const base = collectionHref(username);
  return {
    _links: [
      selfLink(`/agents/${username}/startup-attachments`),
      schemaLink("UpdateStartupAttachment"),
    ],
    _linkTemplates: [
      {
        rel: "item",
        hrefTemplate: `${base}?path={path}`,
        title: "A startup attachment by path",
      },
    ],
    _actions: resolveActions<AttachmentCtx>([ADD_DEF], base, { user }),
    _actionTemplates: resolveActionTemplates<AttachmentCtx>(
      ITEM_OP_DEFS,
      base,
      {
        user,
      },
    ),
  };
}

/** Attach per-item actions to a service result before returning it. */
function withItemActions(
  username: string,
  user: SupervisorUser | undefined,
  item: StartupAttachment,
): StartupAttachment {
  return { ...item, _actions: itemActions(username, item.path, user) };
}

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
      const user = request.supervisorUser;

      return {
        items: rawItems.map((item) => ({
          ...item,
          _actions: itemActions(username, item.path, user),
        })),
        ...discoveryBlock(username, user),
      };
    },
  );

  // OPTIONS /:username/startup-attachments — method & action discovery
  fastify.options<{ Params: AgentUsernameParams }>(
    "/:username/startup-attachments",
    { schema: { hide: true } },
    async (request, reply) => {
      const { username } = request.params;
      const id = resolveAgentId(username);
      if (!id) return notFound(reply, `Agent '${username}' not found`);

      reply.header("Allow", "OPTIONS, GET, POST, PUT, DELETE");
      return discoveryBlock(username, request.supervisorUser);
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
        return {
          success: true,
          item: withItemActions(username, request.supervisorUser, item),
        };
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
        querystring: PathQuerySchema,
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
        return {
          success: true,
          item: withItemActions(username, request.supervisorUser, item),
        };
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

  // PUT /:username/startup-attachments/content?path=... — replace file content
  fastify.put<{
    Params: AgentUsernameParams;
    Querystring: { path: string };
    Reply: StartupAttachmentResponse | ErrorResponse;
  }>(
    "/:username/startup-attachments/content",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description:
          "Replace the file content of an existing startup attachment, " +
          "keeping its path (multipart/form-data with a 'file' field)",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        querystring: PathQuerySchema,
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

      let file: { buffer: Buffer; filename: string } | null = null;

      for await (const part of request.parts()) {
        if (part.type === "file" && part.fieldname === "file") {
          const f = part as MultipartFile;
          file = {
            buffer: await f.toBuffer(),
            filename: f.filename || "unnamed",
          };
        }
      }

      if (!file) return badRequest(reply, "Missing 'file' field");

      const { path } = request.query;
      try {
        const item = await replaceStartupAttachmentContent(
          id,
          path,
          file.buffer,
          file.filename,
        );
        return {
          success: true,
          item: withItemActions(username, request.supervisorUser, item),
        };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to replace content";
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
        querystring: PathQuerySchema,
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
