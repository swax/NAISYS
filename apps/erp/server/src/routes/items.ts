import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateItemSchema,
  ErrorResponseSchema,
  ItemListQuerySchema,
  ItemListResponseSchema,
  ItemSchema,
  KeyCreateResponseSchema,
  MutateResponseSchema,
  UpdateItemSchema,
} from "@naisys/erp-shared";
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
import {
  calcNextSeqNo,
  childItemLinks,
  formatAuditFields,
  mutationResult,
  permGate,
} from "../route-helpers.js";
import type { FieldWithUsers } from "../services/field-service.js";
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
  const href = `${API_PREFIX}/${RESOURCE}/${key}`;
  const gate = permGate(hasPermission(user, "item_manager"), "item_manager");
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateItem`,
      ...gate,
    },
    {
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
      ...gate,
    },
  ];
}

function formatItemFieldListResponse(
  itemKey: string,
  user: ErpUser | undefined,
  fields: FieldWithUsers[],
) {
  const maxSeq = fields.length > 0 ? fields[fields.length - 1].seqNo : 0;
  const base = `/items/${itemKey}/fields`;
  return {
    items: fields.map((field) => formatItemField(itemKey, user, field)),
    total: fields.length,
    nextSeqNo: calcNextSeqNo(maxSeq),
    _links: [selfLink(base)],
    _actions: [
      {
        rel: "create" as const,
        href: `${API_PREFIX}${base}`,
        method: "POST" as const,
        title: "Add Field",
        schema: `${API_PREFIX}/schemas/CreateField`,
        ...permGate(hasPermission(user, "item_manager"), "item_manager"),
      },
    ],
  };
}

function formatItemField(
  itemKey: string,
  user: ErpUser | undefined,
  field: FieldWithUsers,
) {
  const base = `/items/${itemKey}/fields`;
  return {
    id: field.id,
    fieldSetId: field.fieldSetId,
    seqNo: field.seqNo,
    label: field.label,
    type: field.type,
    isArray: field.isArray,
    required: field.required,
    ...formatAuditFields(field),
    _links: childItemLinks(
      base,
      field.seqNo,
      "Fields",
      `/items/${itemKey}`,
      "Item",
      "Field",
    ),
    _actions: (() => {
      const gate = permGate(hasPermission(user, "item_manager"), "item_manager");
      return [
        {
          rel: "update",
          href: `${API_PREFIX}${base}/${field.seqNo}`,
          method: "PUT" as const,
          title: "Update",
          schema: `${API_PREFIX}/schemas/UpdateField`,
          ...gate,
        },
        {
          rel: "delete",
          href: `${API_PREFIX}${base}/${field.seqNo}`,
          method: "DELETE" as const,
          title: "Delete",
          ...gate,
        },
      ];
    })(),
  };
}

function formatItem(item: ItemWithUsers, user: ErpUser | undefined) {
  return {
    id: item.id,
    key: item.key,
    description: item.description,
    fields: formatItemFieldListResponse(
      item.key,
      user,
      item.fieldSet?.fields ?? [],
    ),
    ...formatAuditFields(item),
    _links: itemLinks(item.key),
    _actions: itemActions(item.key, user),
  };
}

function formatListItem(item: ItemWithUsers, user: ErpUser | undefined) {
  return {
    id: item.id,
    key: item.key,
    description: item.description,
    fields: formatItemFieldListResponse(
      item.key,
      user,
      item.fieldSet?.fields ?? [],
    ),
    ...formatAuditFields(item),
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
        items: items.map((item) => formatListItem(item, request.erpUser)),
        total,
        page,
        pageSize,
        _links: paginationLinks(RESOURCE, page, pageSize, total, { search }),
        _linkTemplates: [
          { rel: "item", hrefTemplate: `${API_PREFIX}/items/{key}` },
        ],
        _actions: [
          {
            rel: "create",
            href: `${API_PREFIX}/${RESOURCE}`,
            method: "POST" as const,
            title: "Create Item",
            schema: `${API_PREFIX}/schemas/CreateItem`,
            ...permGate(
              hasPermission(request.erpUser, "item_manager"),
              "item_manager",
            ),
          },
        ],
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
        201: KeyCreateResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { key, description } = request.body;
      const userId = request.erpUser!.id;

      const item = await createItem(key, description, userId);

      const full = formatItem(item, request.erpUser);
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
        200: MutateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { key } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Item '${key}' not found`);
      }

      const item = await updateItem(key, data, userId);

      const full = formatItem(item, request.erpUser);
      return mutationResult(request, reply, full, {
        _actions: full._actions,
      });
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
    preHandler: requirePermission("item_manager"),
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
