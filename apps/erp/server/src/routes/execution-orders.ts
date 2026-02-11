import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";
import {
  CreateExecutionOrderSchema,
  ErrorResponseSchema,
  ExecutionOrderListQuerySchema,
  ExecutionOrderListResponseSchema,
  ExecutionOrderSchema,
  UpdateExecutionOrderSchema,
  type ExecutionOrderPriority,
  type ExecutionOrderStatus,
} from "@naisys-erp/shared";
import { writeAuditEntry } from "../audit.js";
import prisma from "../db.js";
import { sendError } from "../error-handler.js";
import {
  execOrderItemLinks,
  execOrderItemActions,
  paginationLinks,
  selfLink,
} from "../hateoas.js";
import type { ExecOrderModel } from "../generated/prisma/models/ExecOrder.js";

const RESOURCE = "execution/orders";

const IdParamsSchema = z.object({
  id: z.coerce.number().int(),
});

function formatDate(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function formatItem(item: ExecOrderModel) {
  return {
    id: item.id,
    orderNo: item.orderNo,
    planOrderId: item.planOrderId,
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
    _links: execOrderItemLinks(item.id, item.planOrderId),
    _actions: execOrderItemActions(item.id, item.status),
  };
}

function formatListItem(item: ExecOrderModel) {
  const { _actions, ...rest } = formatItem(item);
  return {
    ...rest,
    _links: [selfLink(`/${RESOURCE}/${item.id}`)],
  };
}

export default async function executionOrderRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List execution orders with pagination and filtering",
      tags: ["Execution Orders"],
      querystring: ExecutionOrderListQuerySchema,
      response: {
        200: ExecutionOrderListResponseSchema,
      },
    },
    handler: async (request) => {
      const { page, pageSize, status, priority, search } = request.query;

      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (priority) where.priority = priority;
      if (search) {
        where.OR = [
          { assignedTo: { contains: search } },
          { notes: { contains: search } },
        ];
      }

      const [items, total] = await Promise.all([
        prisma.execOrder.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.execOrder.count({ where }),
      ]);

      return {
        items: items.map(formatListItem),
        total,
        page,
        pageSize,
        _links: [
          ...paginationLinks(RESOURCE, page, pageSize, total, {
            status,
            priority,
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
      description: "Create a new execution order",
      tags: ["Execution Orders"],
      body: CreateExecutionOrderSchema,
      response: {
        201: ExecutionOrderSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {
        planOrderId,
        planOrderRevId,
        priority,
        scheduledStartAt,
        dueAt,
        assignedTo,
        notes,
      } = request.body;
      const userId = request.erpUser!.id;

      // Validate planning order exists
      const planOrder = await prisma.planningOrder.findUnique({
        where: { id: planOrderId },
      });
      if (!planOrder) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Planning order ${planOrderId} not found`,
        );
      }

      // Validate revision exists and belongs to the planning order
      const planOrderRev = await prisma.planningOrderRevision.findFirst({
        where: { id: planOrderRevId, planOrderId },
      });
      if (!planOrderRev) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Planning order revision ${planOrderRevId} not found for order ${planOrderId}`,
        );
      }

      // Auto-increment orderNo inside a transaction to prevent race conditions
      const item = await prisma.$transaction(async (tx) => {
        const maxOrder = await tx.execOrder.findFirst({
          where: { planOrderId },
          orderBy: { orderNo: "desc" },
          select: { orderNo: true },
        });
        const nextOrderNo = (maxOrder?.orderNo ?? 0) + 1;

        return tx.execOrder.create({
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
      return formatItem(item);
    },
  });

  // GET by ID
  app.get("/:id", {
    schema: {
      description: "Get a single execution order by ID",
      tags: ["Execution Orders"],
      params: IdParamsSchema,
      response: {
        200: ExecutionOrderSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const item = await prisma.execOrder.findUnique({ where: { id } });
      if (!item) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found`,
        );
      }

      return formatItem(item);
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
      const { id } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found`,
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

      const item = await prisma.execOrder.update({
        where: { id },
        data: updateData,
      });

      return formatItem(item);
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
      const { id } = request.params;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found`,
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

      await prisma.execOrder.delete({ where: { id } });
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
      const { id } = request.params;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found`,
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
      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.execOrder.update({
          where: { id },
          data: { status: "started", updatedById: userId },
        });
        await writeAuditEntry(
          tx,
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

      return formatItem(item);
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
      const { id } = request.params;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found`,
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
      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.execOrder.update({
          where: { id },
          data: { status: "closed", updatedById: userId },
        });
        await writeAuditEntry(
          tx,
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

      return formatItem(item);
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
      const { id } = request.params;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Execution order ${id} not found`,
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
      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.execOrder.update({
          where: { id },
          data: { status: "cancelled", updatedById: userId },
        });
        await writeAuditEntry(
          tx,
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

      return formatItem(item);
    },
  });
}
