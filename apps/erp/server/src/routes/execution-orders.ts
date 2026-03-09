import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateExecutionOrderSchema,
  ErrorResponseSchema,
  ExecutionOrderListQuerySchema,
  ExecutionOrderListResponseSchema,
  type ExecutionOrderPriority,
  ExecutionOrderSchema,
  type ExecutionOrderStatus,
  UpdateExecutionOrderSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import type { ExecOrderModel } from "../generated/prisma/models/ExecOrder.js";
import {
  API_PREFIX,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";

function execResource(orderKey: string) {
  return `orders/${orderKey}/runs`;
}

function execOrderItemLinks(
  orderKey: string,
  id: number,
): HateoasLink[] {
  const resource = execResource(orderKey);
  return [
    selfLink(`/${resource}/${id}`),
    {
      rel: "collection",
      href: `${API_PREFIX}/${resource}`,
      title: "Runs",
    },
    {
      rel: "planning-order",
      href: `${API_PREFIX}/orders/${orderKey}`,
      title: "Planning Order",
    },
    schemaLink("ExecutionOrder"),
  ];
}

function execOrderItemActions(
  orderKey: string,
  id: number,
  status: string,
): HateoasAction[] {
  const href = `${API_PREFIX}/${execResource(orderKey)}/${id}`;
  const actions: HateoasAction[] = [];

  if (status === "released") {
    actions.push(
      {
        rel: "update",
        href,
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/schemas/UpdateExecutionOrder`,
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
        schema: `${API_PREFIX}/schemas/UpdateExecutionOrder`,
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
  return erpDb.planningOrder.findUnique({
    where: { key: orderKey },
  });
}

function formatItem(orderKey: string, item: ExecOrderModel) {
  return {
    id: item.id,
    orderNo: item.orderNo,
    planOrderId: item.planOrderId,
    planOrderKey: orderKey,
    planOrderRevId: item.planOrderRevId,
    status: item.status as ExecutionOrderStatus,
    priority: item.priority as ExecutionOrderPriority,
    scheduledStartAt: formatDate(item.scheduledStartAt),
    dueAt: formatDate(item.dueAt),
    releasedAt: item.releasedAt.toISOString(),
    assignedTo: item.assignedTo,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdById,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedById,
    _links: execOrderItemLinks(orderKey, item.id),
    _actions: execOrderItemActions(orderKey, item.id, item.status),
  };
}

function formatListItem(orderKey: string, item: ExecOrderModel) {
  const { _actions, ...rest } = formatItem(orderKey, item);
  return {
    ...rest,
    _links: [selfLink(`/${execResource(orderKey)}/${item.id}`)],
  };
}

export default function executionOrderRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List execution orders (runs) for a planning order",
      tags: ["Execution Orders"],
      params: OrderKeyParamsSchema,
      querystring: ExecutionOrderListQuerySchema,
      response: {
        200: ExecutionOrderListResponseSchema,
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
          `Planning order '${orderKey}' not found`,
        );
      }

      const where: Record<string, unknown> = { planOrderId: order.id };
      if (status) where.status = status;
      if (priority) where.priority = priority;
      if (search) {
        where.OR = [
          { assignedTo: { contains: search } },
          { notes: { contains: search } },
        ];
      }

      const [items, total] = await Promise.all([
        erpDb.execOrder.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        erpDb.execOrder.count({ where }),
      ]);

      const resource = execResource(orderKey);

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
      description: "Create a new execution order (run) for a planning order",
      tags: ["Execution Orders"],
      params: OrderKeyParamsSchema,
      body: CreateExecutionOrderSchema,
      response: {
        201: ExecutionOrderSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const {
        planOrderRevId,
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
          `Planning order '${orderKey}' not found`,
        );
      }

      const planOrderId = order.id;

      // Validate revision exists and belongs to the planning order
      const planOrderRev = await erpDb.planningOrderRevision.findFirst({
        where: { id: planOrderRevId, planOrderId },
      });
      if (!planOrderRev) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Planning order revision ${planOrderRevId} not found for order '${orderKey}'`,
        );
      }

      // Auto-increment orderNo inside a transaction to prevent race conditions
      const item = await erpDb.$transaction(async (erpTx) => {
        const maxOrder = await erpTx.execOrder.findFirst({
          where: { planOrderId },
          orderBy: { orderNo: "desc" },
          select: { orderNo: true },
        });
        const nextOrderNo = (maxOrder?.orderNo ?? 0) + 1;

        return erpTx.execOrder.create({
          data: {
            orderNo: nextOrderNo,
            planOrderId,
            planOrderRevId,
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
      description: "Get a single execution order (run) by ID",
      tags: ["Execution Orders"],
      params: IdParamsSchema,
      response: {
        200: ExecutionOrderSchema,
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
          `Planning order '${orderKey}' not found`,
        );
      }

      const item = await erpDb.execOrder.findUnique({ where: { id } });
      if (!item || item.planOrderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found for order '${orderKey}'`,
        );
      }

      return formatItem(orderKey, item);
    },
  });

  // UPDATE (released/started only)
  app.put("/:id", {
    schema: {
      description:
        "Update an execution order (released or started status only)",
      tags: ["Execution Orders"],
      params: IdParamsSchema,
      body: UpdateExecutionOrderSchema,
      response: {
        200: ExecutionOrderSchema,
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
          `Planning order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.execOrder.findUnique({ where: { id } });
      if (!existing || existing.planOrderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "released" && existing.status !== "started") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot update execution order in ${existing.status} status`,
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

      const item = await erpDb.execOrder.update({
        where: { id },
        data: updateData,
      });

      return formatItem(orderKey, item);
    },
  });

  // DELETE (released only)
  app.delete("/:id", {
    schema: {
      description: "Delete an execution order (released status only)",
      tags: ["Execution Orders"],
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
          `Planning order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.execOrder.findUnique({ where: { id } });
      if (!existing || existing.planOrderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "released") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot delete execution order in ${existing.status} status`,
        );
      }

      await erpDb.execOrder.delete({ where: { id } });
      reply.status(204);
    },
  });

  // START (released → started)
  app.post("/:id/start", {
    schema: {
      description: "Start an execution order (released → started)",
      tags: ["Execution Orders"],
      params: IdParamsSchema,
      response: {
        200: ExecutionOrderSchema,
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
          `Planning order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.execOrder.findUnique({ where: { id } });
      if (!existing || existing.planOrderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "released") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot start execution order in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.execOrder.update({
          where: { id },
          data: { status: "started", updatedById: userId },
        });
        await writeAuditEntry(
          erpTx,
          "ExecOrder",
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
      description: "Close an execution order (started → closed)",
      tags: ["Execution Orders"],
      params: IdParamsSchema,
      response: {
        200: ExecutionOrderSchema,
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
          `Planning order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.execOrder.findUnique({ where: { id } });
      if (!existing || existing.planOrderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "started") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot close execution order in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.execOrder.update({
          where: { id },
          data: { status: "closed", updatedById: userId },
        });
        await writeAuditEntry(
          erpTx,
          "ExecOrder",
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
      description: "Cancel an execution order (released/started → cancelled)",
      tags: ["Execution Orders"],
      params: IdParamsSchema,
      response: {
        200: ExecutionOrderSchema,
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
          `Planning order '${orderKey}' not found`,
        );
      }

      const existing = await erpDb.execOrder.findUnique({ where: { id } });
      if (!existing || existing.planOrderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== "released" && existing.status !== "started") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot cancel execution order in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.execOrder.update({
          where: { id },
          data: { status: "cancelled", updatedById: userId },
        });
        await writeAuditEntry(
          erpTx,
          "ExecOrder",
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
