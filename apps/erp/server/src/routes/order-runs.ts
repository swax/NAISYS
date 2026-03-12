import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateOrderRunSchema,
  ErrorResponseSchema,
  OrderRunListQuerySchema,
  OrderRunListResponseSchema,
  OrderRunPriority,
  OrderRunSchema,
  OrderRunStatus,
  UpdateOrderRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { writeAuditEntry } from "../audit.js";
import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
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

function orderRunItemLinks(orderKey: string, id: number): HateoasLink[] {
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
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "manage_runs")) return [];
  const href = `${API_PREFIX}/${runResource(orderKey)}/${id}`;
  const actions: HateoasAction[] = [];

  if (status === OrderRunStatus.released) {
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
  } else if (status === OrderRunStatus.started) {
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

type OrderRunWithRev = OrderRunModel & {
  orderRev: { revNo: number };
  createdBy: { username: string };
  updatedBy: { username: string };
};
const includeRev = {
  orderRev: { select: { revNo: true } },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

function formatItem(
  orderKey: string,
  user: ErpUser | undefined,
  item: OrderRunWithRev,
) {
  return {
    id: item.id,
    runNo: item.runNo,
    orderId: item.orderId,
    orderKey,
    revNo: item.orderRev.revNo,
    status: item.status,
    priority: item.priority,
    scheduledStartAt: formatDate(item.scheduledStartAt),
    dueAt: formatDate(item.dueAt),
    releasedAt: item.releasedAt.toISOString(),
    assignedTo: item.assignedTo,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy.username,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedBy.username,
    _links: orderRunItemLinks(orderKey, item.id),
    _actions: orderRunItemActions(orderKey, item.id, item.status, user),
  };
}

function formatListItem(
  orderKey: string,
  user: ErpUser | undefined,
  item: OrderRunWithRev,
) {
  const { _actions, ...rest } = formatItem(orderKey, user, item);
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
          include: includeRev,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        erpDb.orderRun.count({ where }),
      ]);

      const resource = runResource(orderKey);

      return {
        items: items.map((item) =>
          formatListItem(orderKey, request.erpUser, item),
        ),
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
      const { revNo, priority, scheduledStartAt, dueAt, assignedTo, notes } =
        request.body;
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
      const orderRev = await erpDb.orderRevision.findUnique({
        where: { orderId_revNo: { orderId, revNo } },
      });
      if (!orderRev) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order revision ${revNo} not found for order '${orderKey}'`,
        );
      }

      // Auto-increment runNo and create child run rows inside a transaction
      const item = await erpDb.$transaction(async (erpTx) => {
        const maxOrder = await erpTx.orderRun.findFirst({
          where: { orderId },
          orderBy: { runNo: "desc" },
          select: { runNo: true },
        });
        const nextRunNo = (maxOrder?.runNo ?? 0) + 1;

        const orderRun = await erpTx.orderRun.create({
          data: {
            runNo: nextRunNo,
            orderId,
            orderRevId: orderRev.id,
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
          include: includeRev,
        });

        // Fetch operations → steps → fields for this revision
        const operations = await erpTx.operation.findMany({
          where: { orderRevId: orderRev.id },
          include: {
            steps: {
              include: { fields: true },
              orderBy: { seqNo: "asc" },
            },
          },
          orderBy: { seqNo: "asc" },
        });

        // Create OperationRun → StepRun → StepFieldValue rows
        for (const op of operations) {
          const opRun = await erpTx.operationRun.create({
            data: {
              orderRunId: orderRun.id,
              operationId: op.id,
              createdById: userId,
              updatedById: userId,
            },
          });

          for (const step of op.steps) {
            const stepRun = await erpTx.stepRun.create({
              data: {
                operationRunId: opRun.id,
                stepId: step.id,
                createdById: userId,
                updatedById: userId,
              },
            });

            for (const field of step.fields) {
              await erpTx.stepFieldValue.create({
                data: {
                  stepRunId: stepRun.id,
                  stepFieldId: field.id,
                  value: "",
                  createdById: userId,
                  updatedById: userId,
                },
              });
            }
          }
        }

        return orderRun;
      });

      reply.status(201);
      return formatItem(orderKey, request.erpUser, item);
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

      const item = await erpDb.orderRun.findUnique({
        where: { id },
        include: includeRev,
      });
      if (!item || item.orderId !== order.id) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      return formatItem(orderKey, request.erpUser, item);
    },
  });

  // UPDATE (released/started only)
  app.put("/:id", {
    schema: {
      description: "Update an order run (released or started status only)",
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

      if (
        existing.status !== OrderRunStatus.released &&
        existing.status !== OrderRunStatus.started
      ) {
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
        include: includeRev,
      });

      return formatItem(orderKey, request.erpUser, item);
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

      if (existing.status !== OrderRunStatus.released) {
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

      if (existing.status !== OrderRunStatus.released) {
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
          data: { status: OrderRunStatus.started, updatedById: userId },
          include: includeRev,
        });
        await writeAuditEntry(
          erpTx,
          "OrderRun",
          id,
          "start",
          "status",
          OrderRunStatus.released,
          OrderRunStatus.started,
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, request.erpUser, item);
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

      if (existing.status !== OrderRunStatus.started) {
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
          data: { status: OrderRunStatus.closed, updatedById: userId },
          include: includeRev,
        });
        await writeAuditEntry(
          erpTx,
          "OrderRun",
          id,
          "close",
          "status",
          OrderRunStatus.started,
          OrderRunStatus.closed,
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, request.erpUser, item);
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

      if (
        existing.status !== OrderRunStatus.released &&
        existing.status !== OrderRunStatus.started
      ) {
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
          data: { status: OrderRunStatus.cancelled, updatedById: userId },
          include: includeRev,
        });
        await writeAuditEntry(
          erpTx,
          "OrderRun",
          id,
          "cancel",
          "status",
          existing.status,
          OrderRunStatus.cancelled,
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, request.erpUser, item);
    },
  });
}
