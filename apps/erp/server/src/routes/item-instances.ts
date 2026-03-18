import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateItemInstanceSchema,
  ErrorResponseSchema,
  ItemInstanceListQuerySchema,
  ItemInstanceListResponseSchema,
  ItemInstanceSchema,
  UpdateItemInstanceSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { notFound } from "../error-handler.js";
import { API_PREFIX, paginationLinks, schemaLink, selfLink } from "../hateoas.js";
import { formatAuditFields } from "../route-helpers.js";
import { findExisting as findItem } from "../services/item-service.js";
import {
  createItemInstance,
  deleteItemInstance,
  findItemInstance,
  type ItemInstanceWithRelations,
  listItemInstances,
  updateItemInstance,
} from "../services/item-instance-service.js";

const ParamsSchema = z.object({
  key: z.string(),
});

const InstanceParamsSchema = z.object({
  key: z.string(),
  instanceId: z.coerce.number(),
});

function instanceBasePath(itemKey: string): string {
  return `items/${itemKey}/instances`;
}

function instanceLinks(
  itemKey: string,
  instanceId: number,
): HateoasLink[] {
  const base = instanceBasePath(itemKey);
  return [
    selfLink(`/${base}/${instanceId}`),
    {
      rel: "collection",
      href: `${API_PREFIX}/${base}`,
      title: "Instances",
    },
    {
      rel: "parent",
      href: `${API_PREFIX}/items/${itemKey}`,
      title: "Item",
    },
    schemaLink("ItemInstance"),
  ];
}

function instanceActions(
  itemKey: string,
  instanceId: number,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "item_manager")) return [];
  const href = `${API_PREFIX}/${instanceBasePath(itemKey)}/${instanceId}`;
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateItemInstance`,
    },
    {
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
    },
  ];
}

function orderRunKey(
  inst: ItemInstanceWithRelations,
): string | null {
  if (!inst.orderRun) return null;
  return `${inst.orderRun.order.key}#${inst.orderRun.runNo}`;
}

function formatInstance(
  inst: ItemInstanceWithRelations,
  user: ErpUser | undefined,
) {
  return {
    id: inst.id,
    itemKey: inst.item.key,
    orderRunKey: orderRunKey(inst),
    key: inst.key,
    quantity: inst.quantity,
    ...formatAuditFields(inst),
    _links: instanceLinks(inst.item.key, inst.id),
    _actions: instanceActions(inst.item.key, inst.id, user),
  };
}

function formatListInstance(
  inst: ItemInstanceWithRelations,
  user: ErpUser | undefined,
) {
  return {
    id: inst.id,
    itemKey: inst.item.key,
    orderRunKey: orderRunKey(inst),
    key: inst.key,
    quantity: inst.quantity,
    ...formatAuditFields(inst),
    _links: [selfLink(`/${instanceBasePath(inst.item.key)}/${inst.id}`)],
  };
}

export default function itemInstanceRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List item instances with pagination and search",
      tags: ["Item Instances"],
      params: ParamsSchema,
      querystring: ItemInstanceListQuerySchema,
      response: {
        200: ItemInstanceListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key } = request.params;
      const { page, pageSize, search } = request.query;

      const item = await findItem(key);
      if (!item) return notFound(reply, `Item '${key}' not found`);

      const where: Record<string, unknown> = { itemId: item.id };
      if (search) {
        where.key = { contains: search };
      }

      const [instances, total] = await listItemInstances(where, page, pageSize);
      const base = instanceBasePath(key);

      return {
        items: instances.map((inst) =>
          formatListInstance(inst, request.erpUser),
        ),
        total,
        page,
        pageSize,
        _links: paginationLinks(base, page, pageSize, total, { search }),
        _actions: hasPermission(request.erpUser, "item_manager")
          ? [
              {
                rel: "create",
                href: `${API_PREFIX}/${base}`,
                method: "POST" as const,
                title: "Create Instance",
                schema: `${API_PREFIX}/schemas/CreateItemInstance`,
              },
            ]
          : [],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new item instance",
      tags: ["Item Instances"],
      params: ParamsSchema,
      body: CreateItemInstanceSchema,
      response: {
        201: ItemInstanceSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { key: itemKey } = request.params;
      const { key, quantity, orderRunId } = request.body;
      const userId = request.erpUser!.id;

      const item = await findItem(itemKey);
      if (!item) return notFound(reply, `Item '${itemKey}' not found`);

      const inst = await createItemInstance(
        item.id,
        key,
        quantity,
        orderRunId,
        userId,
      );

      reply.status(201);
      return formatInstance(inst, request.erpUser);
    },
  });

  // GET by id
  app.get("/:instanceId", {
    schema: {
      description: "Get a single item instance",
      tags: ["Item Instances"],
      params: InstanceParamsSchema,
      response: {
        200: ItemInstanceSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { instanceId } = request.params;

      const inst = await findItemInstance(instanceId);
      if (!inst) return notFound(reply, `Item instance ${instanceId} not found`);

      return formatInstance(inst, request.erpUser);
    },
  });

  // UPDATE
  app.put("/:instanceId", {
    schema: {
      description: "Update an item instance",
      tags: ["Item Instances"],
      params: InstanceParamsSchema,
      body: UpdateItemInstanceSchema,
      response: {
        200: ItemInstanceSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { instanceId } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const existing = await findItemInstance(instanceId);
      if (!existing)
        return notFound(reply, `Item instance ${instanceId} not found`);

      const inst = await updateItemInstance(instanceId, data, userId);
      return formatInstance(inst, request.erpUser);
    },
  });

  // DELETE
  app.delete("/:instanceId", {
    schema: {
      description: "Delete an item instance",
      tags: ["Item Instances"],
      params: InstanceParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("item_manager"),
    handler: async (request, reply) => {
      const { instanceId } = request.params;

      const existing = await findItemInstance(instanceId);
      if (!existing)
        return notFound(reply, `Item instance ${instanceId} not found`);

      await deleteItemInstance(instanceId);
      reply.status(204);
    },
  });
}
