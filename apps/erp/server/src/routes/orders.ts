import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateOrderSchema,
  ErrorResponseSchema,
  OrderListQuerySchema,
  OrderListResponseSchema,
  OrderSchema,
  UpdateOrderSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import type { OrderModel } from "../generated/prisma/models/Order.js";
import {
  API_PREFIX,
  collectionLink,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";

function itemLinks(
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

function itemActions(
  resource: string,
  key: string,
  status: string,
): HateoasAction[] {
  const href = `${API_PREFIX}/${resource}/${key}`;
  const actions: HateoasAction[] = [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateOrder`,
    },
  ];

  if (status === "active") {
    actions.push({
      rel: "archive",
      href,
      method: "PUT",
      title: "Archive",
      body: { status: "archived" },
    });
  } else {
    actions.push({
      rel: "activate",
      href,
      method: "PUT",
      title: "Activate",
      body: { status: "active" },
    });
  }

  actions.push({
    rel: "delete",
    href,
    method: "DELETE",
    title: "Delete",
  });

  return actions;
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

const RESOURCE = "orders";

const KeyParamsSchema = z.object({
  key: z.string(),
});

function formatItem(item: OrderModel) {
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    description: item.description,
    status: item.status,
    createdBy: item.createdById,
    createdAt: item.createdAt.toISOString(),
    updatedBy: item.updatedById,
    updatedAt: item.updatedAt.toISOString(),
    _links: [
      ...itemLinks(RESOURCE, item.key, "Order"),
      revisionCollectionLink(RESOURCE, item.key),
    ],
    _actions: itemActions(RESOURCE, item.key, item.status),
  };
}

function formatListItem(item: OrderModel) {
  const { _actions, ...rest } = formatItem(item);
  return {
    ...rest,
    _links: [selfLink(`/${RESOURCE}/${item.key}`)],
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
          { name: { contains: search } },
          { key: { contains: search } },
          { description: { contains: search } },
        ];
      }

      const [items, total] = await Promise.all([
        erpDb.order.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        erpDb.order.count({ where }),
      ]);

      return {
        items: items.map(formatListItem),
        total,
        page,
        pageSize,
        _links: [
          ...paginationLinks(RESOURCE, page, pageSize, total, {
            status,
            search,
          }),
          {
            rel: "create",
            href: `/api/erp/${RESOURCE}`,
            method: "POST",
          },
        ],
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
      },
    },
    handler: async (request, reply) => {
      const { key, name, description } = request.body;
      const userId = request.erpUser!.id;

      const item = await erpDb.order.create({
        data: {
          key,
          name,
          description,
          createdById: userId,
          updatedById: userId,
        },
      });

      reply.status(201);
      return formatItem(item);
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

      const item = await erpDb.order.findUnique({ where: { key } });
      if (!item) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${key}' not found`,
        );
      }

      return formatItem(item);
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
    handler: async (request, reply) => {
      const { key } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const existing = await erpDb.order.findUnique({
        where: { key },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${key}' not found`,
        );
      }

      const item = await erpDb.order.update({
        where: { key },
        data: { ...data, updatedById: userId },
      });

      return formatItem(item);
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
    handler: async (request, reply) => {
      const { key } = request.params;

      const existing = await erpDb.order.findUnique({
        where: { key },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${key}' not found`,
        );
      }

      const revisionCount = await erpDb.orderRevision.count({
        where: { orderId: existing.id },
      });
      if (revisionCount > 0) {
        return sendError(
          reply,
          409,
          "Conflict",
          "Cannot delete order with existing revisions. Archive it instead.",
        );
      }

      await erpDb.order.delete({ where: { key } });
      reply.status(204);
    },
  });
}
