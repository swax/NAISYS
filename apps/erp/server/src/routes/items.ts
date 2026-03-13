import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateItemSchema,
  ErrorResponseSchema,
  ItemListQuerySchema,
  ItemListResponseSchema,
  ItemSchema,
  UpdateItemSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import { notFound } from "../error-handler.js";
import {
  API_PREFIX,
  collectionLink,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import { formatAuditFields } from "../route-helpers.js";
import {
  createItem,
  deleteItem,
  findExisting,
  type ItemWithUsers,
  listItems,
  updateItem,
} from "../services/item-service.js";

const RESOURCE = "items";

const KeyParamsSchema = z.object({
  key: z.string(),
});

function itemLinks(key: string): HateoasLink[] {
  return [
    selfLink(`/${RESOURCE}/${key}`),
    collectionLink(RESOURCE),
    schemaLink("Item"),
  ];
}

function itemActions(key: string, user: ErpUser | undefined): HateoasAction[] {
  if (!hasPermission(user, "manage_orders")) return [];
  const href = `${API_PREFIX}/${RESOURCE}/${key}`;
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateItem`,
    },
    {
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
    },
  ];
}

function formatItem(item: ItemWithUsers, user: ErpUser | undefined) {
  return {
    id: item.id,
    key: item.key,
    description: item.description,
    ...formatAuditFields(item),
    _links: itemLinks(item.key),
    _actions: itemActions(item.key, user),
  };
}

function formatListItem(item: ItemWithUsers) {
  return {
    id: item.id,
    key: item.key,
    description: item.description,
    ...formatAuditFields(item),
    _links: [selfLink(`/${RESOURCE}/${item.key}`)],
  };
}

export default function itemRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List items with pagination and search",
      tags: ["Items"],
      querystring: ItemListQuerySchema,
      response: {
        200: ItemListResponseSchema,
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

      const [items, total] = await listItems(where, page, pageSize);

      return {
        items: items.map((item) => formatListItem(item)),
        total,
        page,
        pageSize,
        _links: paginationLinks(RESOURCE, page, pageSize, total, { search }),
        _actions: hasPermission(request.erpUser, "manage_orders")
          ? [
              {
                rel: "create",
                href: `${API_PREFIX}/${RESOURCE}`,
                method: "POST" as const,
                title: "Create Item",
                schema: `${API_PREFIX}/schemas/CreateItem`,
              },
            ]
          : [],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new item",
      tags: ["Items"],
      body: CreateItemSchema,
      response: {
        201: ItemSchema,
      },
    },
    handler: async (request, reply) => {
      const { key, description } = request.body;
      const userId = request.erpUser!.id;

      const item = await createItem(key, description, userId);

      reply.status(201);
      return formatItem(item, request.erpUser);
    },
  });

  // GET by key
  app.get("/:key", {
    schema: {
      description: "Get a single item by key",
      tags: ["Items"],
      params: KeyParamsSchema,
      response: {
        200: ItemSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key } = request.params;

      const item = await findExisting(key);
      if (!item) {
        return notFound(reply, `Item '${key}' not found`);
      }

      return formatItem(item, request.erpUser);
    },
  });

  // UPDATE
  app.put("/:key", {
    schema: {
      description: "Update an item",
      tags: ["Items"],
      params: KeyParamsSchema,
      body: UpdateItemSchema,
      response: {
        200: ItemSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Item '${key}' not found`);
      }

      const item = await updateItem(key, data, userId);

      return formatItem(item, request.erpUser);
    },
  });

  // DELETE
  app.delete("/:key", {
    schema: {
      description: "Delete an item",
      tags: ["Items"],
      params: KeyParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key } = request.params;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Item '${key}' not found`);
      }

      await deleteItem(key);
      reply.status(204);
    },
  });
}
