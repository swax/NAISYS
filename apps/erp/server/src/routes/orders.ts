import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateOrderSchema,
  ErrorResponseSchema,
  OrderListQuerySchema,
  OrderListResponseSchema,
  OrderSchema,
  OrderStatus,
  UpdateOrderSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import {
  API_PREFIX,
  collectionLink,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import { formatAuditFields, permGate, resolveActions } from "../route-helpers.js";
import {
  checkHasRevisions,
  createOrder,
  deleteOrder,
  findExisting,
  listOrders,
  type OrderWithRelations,
  resolveItemKey,
  updateOrder,
} from "../services/order-service.js";

function orderLinks(
  resource: string,
  key: string,
  schemaName: string,
): HateoasLink[] {
  return [
    selfLink(`/${resource}/${key}`),
    collectionLink(resource),
    schemaLink(schemaName),
  ];
}

function orderActions(
  resource: string, key: string, status: string, user: ErpUser | undefined,
): HateoasAction[] {
  const href = `${API_PREFIX}/${resource}/${key}`;

  return resolveActions([
    {
      rel: "update",
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateOrder`,
      permission: "order_planner",
    },
    {
      rel: "archive",
      method: "PUT",
      title: "Archive",
      body: { status: OrderStatus.archived },
      permission: "order_planner",
      statuses: [OrderStatus.active],
    },
    {
      rel: "activate",
      method: "PUT",
      title: "Activate",
      body: { status: OrderStatus.active },
      permission: "order_planner",
      statuses: [OrderStatus.archived],
    },
    {
      rel: "delete",
      method: "DELETE",
      title: "Delete",
      permission: "order_manager",
    },
  ], href, { status, user });
}

function revisionCollectionLink(
  parentResource: string,
  key: string,
): HateoasLink {
  return {
    rel: "revisions",
    href: `${API_PREFIX}/${parentResource}/${key}/revs`,
    title: "Revisions",
  };
}

function runsCollectionLink(parentResource: string, key: string): HateoasLink {
  return {
    rel: "runs",
    href: `${API_PREFIX}/${parentResource}/${key}/runs`,
    title: "Order Runs",
  };
}

const RESOURCE = "orders";

const KeyParamsSchema = z.object({
  key: z.string(),
});

function formatOrder(order: OrderWithRelations, user: ErpUser | undefined) {
  return {
    id: order.id,
    key: order.key,
    description: order.description,
    status: order.status,
    itemKey: order.item?.key ?? null,
    ...formatAuditFields(order),
    _links: [
      ...orderLinks(RESOURCE, order.key, "Order"),
      revisionCollectionLink(RESOURCE, order.key),
      runsCollectionLink(RESOURCE, order.key),
    ],
    _actions: orderActions(RESOURCE, order.key, order.status, user),
  };
}

function formatListOrder(order: OrderWithRelations, user: ErpUser | undefined) {
  const { _actions, ...rest } = formatOrder(order, user);
  return {
    ...rest,
    _links: [selfLink(`/${RESOURCE}/${order.key}`)],
  };
}

export default function orderRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List orders with pagination and filtering",
      tags: ["Orders"],
      querystring: OrderListQuerySchema,
      response: {
        200: OrderListResponseSchema,
      },
    },
    handler: async (request) => {
      const { page, pageSize, status, search } = request.query;

      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { key: { contains: search } },
          { description: { contains: search } },
        ];
      }

      const [items, total] = await listOrders(where, page, pageSize);

      return {
        items: items.map((order) => formatListOrder(order, request.erpUser)),
        total,
        page,
        pageSize,
        _links: paginationLinks(RESOURCE, page, pageSize, total, {
          status,
          search,
        }),
        _actions: [{
          rel: "create",
          href: `${API_PREFIX}/${RESOURCE}`,
          method: "POST" as const,
          title: "Create Order",
          schema: `${API_PREFIX}/schemas/CreateOrder`,
          ...permGate(hasPermission(request.erpUser, "order_planner"), "order_planner"),
        }],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new order",
      tags: ["Orders"],
      body: CreateOrderSchema,
      response: {
        201: OrderSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { key, description, itemKey } = request.body;
      const userId = request.erpUser!.id;

      let itemId: number | null = null;
      if (itemKey) {
        try {
          itemId = await resolveItemKey(itemKey);
        } catch {
          return notFound(reply, `Item '${itemKey}' not found`);
        }
      }

      const order = await createOrder(key, description, itemId, userId);

      reply.status(201);
      return formatOrder(order, request.erpUser);
    },
  });

  // GET by key
  app.get("/:key", {
    schema: {
      description: "Get a single order by key",
      tags: ["Orders"],
      params: KeyParamsSchema,
      response: {
        200: OrderSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { key } = request.params;

      const order = await findExisting(key);
      if (!order) {
        return notFound(reply, `Order '${key}' not found`);
      }

      return formatOrder(order, request.erpUser);
    },
  });

  // UPDATE
  app.put("/:key", {
    schema: {
      description: "Update an order",
      tags: ["Orders"],
      params: KeyParamsSchema,
      body: UpdateOrderSchema,
      response: {
        200: OrderSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { key } = request.params;
      const { itemKey, ...rest } = request.body;
      const userId = request.erpUser!.id;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Order '${key}' not found`);
      }

      const dbData: Record<string, unknown> = { ...rest };
      if (itemKey !== undefined) {
        if (itemKey === null) {
          dbData.itemId = null;
        } else {
          try {
            dbData.itemId = await resolveItemKey(itemKey);
          } catch {
            return notFound(reply, `Item '${itemKey}' not found`);
          }
        }
      }

      const order = await updateOrder(key, dbData, userId);

      return formatOrder(order, request.erpUser);
    },
  });

  // DELETE
  app.delete("/:key", {
    schema: {
      description: "Delete an order",
      tags: ["Orders"],
      params: KeyParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { key } = request.params;

      const existing = await findExisting(key);
      if (!existing) {
        return notFound(reply, `Order '${key}' not found`);
      }

      const hasRevisions = await checkHasRevisions(existing.id);
      if (hasRevisions) {
        return conflict(
          reply,
          "Cannot delete order with existing revisions. Archive it instead.",
        );
      }

      await deleteOrder(key);
      reply.status(204);
    },
  });
}
