import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateOrderRunSchema,
  ErrorResponseSchema,
  OrderRunListQuerySchema,
  OrderRunListResponseSchema,
  type OrderRunPriority,
  OrderRunSchema,
  type OrderRunStatus,
  UpdateOrderRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import type { OrderRunModel } from "../generated/prisma/models/OrderRun.js";
import {
  API_PREFIX,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";

function runResource(orderKey: string) {
  return `orders/${orderKey}/runs`;
}

function orderRunItemLinks(
  orderKey: string,
  id: number,
): HateoasLink[] {
  const resource = runResource(orderKey);
  return [
    selfLink(`/${resource}/${id}`),
    {
      rel: "collection",
      href: `${API_PREFIX}/${resource}`,
      title: "Runs",
    },
    {
      rel: "order",
      href: `${API_PREFIX}/orders/${orderKey}`,
      title: "Order",
    },
    schemaLink("OrderRun"),
  ];
}

function orderRunItemActions(
  orderKey: string,
  id: number,
  status: string,
): HateoasAction[] {
  const href = `${API_PREFIX}/${runResource(orderKey)}/${id}`;
  const actions: HateoasAction[] = [];

  if (status === "released") {
    actions.push(
      {
        rel: "update",
        href,
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/schemas/UpdateOrderRun`,
      },
      {
        rel: "start",
        href: `${href}/start`,
        method: "POST",
        title: "Start",
      },
      {
        rel: "cancel",
        href: `${href}/cancel`,
        method: "POST",
        title: "Cancel",
      },
      {
        rel: "delete",
        href,
        method: "DELETE",
        title: "Delete",
      },
    );
  } else if (status === "started") {
    actions.push(
      {
        rel: "update",
        href,
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/schemas/UpdateOrderRun`,
      },
      {
        rel: "close",
        href: `${href}/close`,
        method: "POST",
        title: "Close",
      },
      {
        rel: "cancel",
        href: `${href}/cancel`,
        method: "POST",
        title: "Cancel",
      },
    );
  }
  // closed/cancelled: no actions

  return actions;
}

const OrderKeyParamsSchema = z.object({
  orderKey: z.string(),
});

const IdParamsSchema = z.object({
  orderKey: z.string(),
  id: z.coerce.number().int(),
});

function formatDate(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

async function resolveOrder(orderKey: string) {
  return erpDb.order.findUnique({
    where: { key: orderKey },
  });
}

function formatItem(orderKey: string, item: OrderRunModel) {
  return {
    id: item.id,
    orderNo: item.orderNo,
    orderId: item.orderId,
    orderKey,
    orderRevId: item.orderRevId,
    status: item.status as OrderRunStatus,
    priority: item.priority as OrderRunPriority,
    scheduledStartAt: formatDate(item.scheduledStartAt),
    dueAt: formatDate(item.dueAt),
    releasedAt: item.releasedAt.toISOString(),
    assignedTo: item.assignedTo,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdById,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedById,
    _links: orderRunItemLinks(orderKey, item.id),
    _actions: orderRunItemActions(orderKey, item.id, item.status),
  };
}

function formatListItem(orderKey: string, item: OrderRunModel) {
  const { _actions, ...rest } = formatItem(orderKey, item);
  return {
    ...rest,
    _links: [selfLink(`/${runResource(orderKey)}/${item.id}`)],
  };
}

export default function orderRunRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List order runs for an order",
      tags: ["Order Runs"],
      params: OrderKeyParamsSchema,
      querystring: OrderRunListQuerySchema,
      response: {
        200: OrderRunListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const { page, pageSize, status, priority, search } = request.query;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const where: Record<string, unknown> = { orderId: order.id };
      if (status) where.status = status;
      if (priority) where.priority = priority;
      if (search) {
        where.OR = [
          { assignedTo: { contains: search } },
          { notes: { contains: search } },
        ];
      }

      const [items, total] = await Promise.all([
        erpDb.orderRun.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        erpDb.orderRun.count({ where }),
      ]);

      const resource = runResource(orderKey);

      return {
        items: items.map((item) => formatListItem(orderKey, item)),
        total,
        page,
        pageSize,
        _links: paginationLinks(resource, page, pageSize, total, {
          status,
          priority,
          search,
        }),
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new order run for an order",
      tags: ["Order Runs"],
      params: OrderKeyParamsSchema,
      body: CreateOrderRunSchema,
      response: {
        201: OrderRunSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const {
        orderRevId,
        priority,
        scheduledStartAt,
        dueAt,
        assignedTo,
        notes,
      } = request.body;
      const userId = request.erpUser!.id;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const orderId = order.id;

      // Validate revision exists and belongs to the order
      const orderRev = await erpDb.orderRevision.findFirst({
        where: { id: orderRevId, orderId },
      });
      if (!orderRev) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order revision ${orderRevId} not found for order '${orderKey}'`,
        );
      }

      // Auto-increment orderNo inside a transaction to prevent race conditions
      const item = await erpDb.$transaction(async (erpTx) => {
        const maxOrder = await erpTx.orderRun.findFirst({
          where: { orderId },
          orderBy: { orderNo: "desc" },
          select: { orderNo: true },
        });
        const nextOrderNo = (maxOrder?.orderNo ?? 0) + 1;

        return erpTx.orderRun.create({
          data: {
            orderNo: nextOrderNo,
            orderId,
            orderRevId,
            priority,
            scheduledStartAt: scheduledStartAt
              ? new Date(scheduledStartAt)
              : null,
            dueAt: dueAt ? new Date(dueAt) : null,
            assignedTo: assignedTo ?? null,
            notes: notes ?? null,
            createdById: userId,
            updatedById: userId,
          },
        });
      });

      reply.status(201);
      return formatItem(orderKey, item);
    },
  });

  // GET by ID
  app.get("/:id", {
    schema: {
      description: "Get a single order run by ID",
      tags: ["Order Runs"],
      params: IdParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, id } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const item = await erpDb.orderRun.findUnique({ where: { id } });
      if (!item || item.orderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      return formatItem(orderKey, item);
    },
  });

  // UPDATE (released/started only)
  app.put("/:id", {
    schema: {
      description:
        "Update an order run (released or started status only)",
      tags: ["Order Runs"],
      params: IdParamsSchema,
      body: UpdateOrderRunSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, id } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.orderRun.findUnique({ where: { id } });
      if (!existing || existing.orderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "released" && existing.status !== "started") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot update order run in ${existing.status} status`,
        );
      }

      const updateData: Record<string, unknown> = { updatedById: userId };
      if (data.priority !== undefined) updateData.priority = data.priority;
      if (data.assignedTo !== undefined)
        updateData.assignedTo = data.assignedTo;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.scheduledStartAt !== undefined) {
        updateData.scheduledStartAt = data.scheduledStartAt
          ? new Date(data.scheduledStartAt)
          : null;
      }
      if (data.dueAt !== undefined) {
        updateData.dueAt = data.dueAt ? new Date(data.dueAt) : null;
      }

      const item = await erpDb.orderRun.update({
        where: { id },
        data: updateData,
      });

      return formatItem(orderKey, item);
    },
  });

  // DELETE (released only)
  app.delete("/:id", {
    schema: {
      description: "Delete an order run (released status only)",
      tags: ["Order Runs"],
      params: IdParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, id } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.orderRun.findUnique({ where: { id } });
      if (!existing || existing.orderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "released") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot delete order run in ${existing.status} status`,
        );
      }

      await erpDb.orderRun.delete({ where: { id } });
      reply.status(204);
    },
  });

  // START (released → started)
  app.post("/:id/start", {
    schema: {
      description: "Start an order run (released → started)",
      tags: ["Order Runs"],
      params: IdParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, id } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.orderRun.findUnique({ where: { id } });
      if (!existing || existing.orderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "released") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot start order run in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.orderRun.update({
          where: { id },
          data: { status: "started", updatedById: userId },
        });
        await writeAuditEntry(
          erpTx,
          "OrderRun",
          id,
          "start",
          "status",
          "released",
          "started",
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, item);
    },
  });

  // CLOSE (started → closed)
  app.post("/:id/close", {
    schema: {
      description: "Close an order run (started → closed)",
      tags: ["Order Runs"],
      params: IdParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, id } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.orderRun.findUnique({ where: { id } });
      if (!existing || existing.orderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "started") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot close order run in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.orderRun.update({
          where: { id },
          data: { status: "closed", updatedById: userId },
        });
        await writeAuditEntry(
          erpTx,
          "OrderRun",
          id,
          "close",
          "status",
          "started",
          "closed",
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, item);
    },
  });

  // CANCEL (released/started → cancelled)
  app.post("/:id/cancel", {
    schema: {
      description: "Cancel an order run (released/started → cancelled)",
      tags: ["Order Runs"],
      params: IdParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, id } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.orderRun.findUnique({ where: { id } });
      if (!existing || existing.orderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "released" && existing.status !== "started") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot cancel order run in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.orderRun.update({
          where: { id },
          data: { status: "cancelled", updatedById: userId },
        });
        await writeAuditEntry(
          erpTx,
          "OrderRun",
          id,
          "cancel",
          "status",
          existing.status,
          "cancelled",
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, item);
    },
  });
}
