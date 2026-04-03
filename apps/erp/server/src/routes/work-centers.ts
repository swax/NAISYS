import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  AssignWorkCenterUserSchema,
  CreateWorkCenterSchema,
  ErrorResponseSchema,
  KeyCreateResponseSchema,
  MutateResponseSchema,
  UpdateWorkCenterSchema,
  WorkCenterListQuerySchema,
  WorkCenterListResponseSchema,
  WorkCenterSchema,
} from "@naisys-erp/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { notFound } from "../error-handler.js";
import {
  API_PREFIX,
  collectionLink,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import { formatAuditFields, mutationResult } from "../route-helpers.js";
import {
  assignUser,
  createWorkCenter,
  deleteWorkCenter,
  findExisting,
  listWorkCenters,
  removeUser,
  updateWorkCenter,
  type WorkCenterWithDetail,
} from "../services/work-center-service.js";

const RESOURCE = "work-centers";

const KeyParamsSchema = z.object({
  key: z.string(),
});

const UserParamsSchema = z.object({
  key: z.string(),
  username: z.string(),
});

function wcLinks(key: string): HateoasLink[] {
  return [
    selfLink(`/${RESOURCE}/${key}`),
    collectionLink(RESOURCE),
    schemaLink("WorkCenter"),
  ];
}

function wcActions(key: string, user: ErpUser | undefined): HateoasAction[] {
  if (!hasPermission(user, "erp_admin")) return [];
  const href = `${API_PREFIX}/${RESOURCE}/${key}`;
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateWorkCenter`,
    },
    {
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
    },
    {
      rel: "assignUser",
      href: `${href}/users`,
      method: "POST",
      title: "Assign User",
      schema: `${API_PREFIX}/schemas/AssignWorkCenterUser`,
    },
  ];
}

function formatWorkCenter(wc: WorkCenterWithDetail, user: ErpUser | undefined) {
  const isAdmin = hasPermission(user, "erp_admin");
  return {
    id: wc.id,
    key: wc.key,
    description: wc.description,
    userAssignments: wc.userAssignments.map((a) => ({
      userId: a.user.id,
      username: a.user.username,
      createdAt: a.createdAt.toISOString(),
      createdBy: a.createdBy?.username ?? null,
      _actions: isAdmin
        ? [
            {
              rel: "remove",
              href: `${API_PREFIX}/${RESOURCE}/${wc.key}/users/${a.user.username}`,
              method: "DELETE" as const,
              title: "Remove",
            },
          ]
        : [],
    })),
    ...formatAuditFields(wc),
    _links: wcLinks(wc.key),
    _actions: wcActions(wc.key, user),
  };
}

function formatListItem(wc: WorkCenterWithDetail) {
  return {
    id: wc.id,
    key: wc.key,
    description: wc.description,
    userCount: wc._count.userAssignments,
    ...formatAuditFields(wc),
  };
}

export default function workCenterRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List work centers with pagination and search",
      tags: ["Work Centers"],
      querystring: WorkCenterListQuerySchema,
      response: {
        200: WorkCenterListResponseSchema,
      },
    },
    handler: async (request) => {
      const { page, pageSize, search } = request.query;

      const where: Record<string, unknown> = {};
      if (search) {
        where.OR = [
          { key: { contains: search } },
          { description: { contains: search } },
        ];
      }

      const [items, total] = await listWorkCenters(where, page, pageSize);

      return {
        items: items.map((wc) => formatListItem(wc)),
        total,
        page,
        pageSize,
        _links: paginationLinks(RESOURCE, page, pageSize, total, { search }),
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}/work-centers/{key}`,
          },
        ],
        _actions: hasPermission(request.erpUser, "erp_admin")
          ? [
              {
                rel: "create",
                href: `${API_PREFIX}/${RESOURCE}`,
                method: "POST" as const,
                title: "Create Work Center",
                schema: `${API_PREFIX}/schemas/CreateWorkCenter`,
              },
            ]
          : [],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new work center",
      tags: ["Work Centers"],
      body: CreateWorkCenterSchema,
      response: {
        201: KeyCreateResponseSchema,
      },
    },
    preHandler: requirePermission("erp_admin"),
    handler: async (request, reply) => {
      const { key, description } = request.body;
      const userId = request.erpUser!.id;

      const wc = await createWorkCenter(key, description, userId);

      const full = formatWorkCenter(wc, request.erpUser);
      reply.status(201);
      return mutationResult(request, reply, full, {
        id: full.id,
        key: full.key,
        _links: full._links,
        _actions: full._actions,
      });
    },
  });

  // GET by key
  app.get("/:key", {
    schema: {
      description: "Get a single work center by key",
      tags: ["Work Centers"],
      params: KeyParamsSchema,
      response: {
        200: WorkCenterSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key } = request.params;

      const wc = await findExisting(key);
      if (!wc) {
        return notFound(reply, `Work center '${key}' not found`);
      }

      return formatWorkCenter(wc, request.erpUser);
    },
  });

  // UPDATE
  app.put("/:key", {
    schema: {
      description: "Update a work center",
      tags: ["Work Centers"],
      params: KeyParamsSchema,
      body: UpdateWorkCenterSchema,
      response: {
        200: MutateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("erp_admin"),
    handler: async (request, reply) => {
      const { key } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Work center '${key}' not found`);
      }

      const wc = await updateWorkCenter(key, data, userId);

      const full = formatWorkCenter(wc, request.erpUser);
      return mutationResult(request, reply, full, {
        _actions: full._actions,
      });
    },
  });

  // DELETE
  app.delete("/:key", {
    schema: {
      description: "Delete a work center",
      tags: ["Work Centers"],
      params: KeyParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("erp_admin"),
    handler: async (request, reply) => {
      const { key } = request.params;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Work center '${key}' not found`);
      }

      await deleteWorkCenter(key);
      reply.status(204);
    },
  });

  // ASSIGN USER
  app.post("/:key/users", {
    schema: {
      description: "Assign a user to a work center",
      tags: ["Work Centers"],
      params: KeyParamsSchema,
      body: AssignWorkCenterUserSchema,
      response: {
        200: MutateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("erp_admin"),
    handler: async (request, reply) => {
      const { key } = request.params;
      const { username } = request.body;
      const userId = request.erpUser!.id;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Work center '${key}' not found`);
      }

      const wc = await assignUser(key, username, userId);

      const full = formatWorkCenter(wc, request.erpUser);
      return mutationResult(request, reply, full, {
        _actions: full._actions,
      });
    },
  });

  // REMOVE USER
  app.delete("/:key/users/:username", {
    schema: {
      description: "Remove a user from a work center",
      tags: ["Work Centers"],
      params: UserParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("erp_admin"),
    handler: async (request, reply) => {
      const { key, username } = request.params;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Work center '${key}' not found`);
      }

      await removeUser(key, username);
      reply.status(204);
    },
  });
}
