import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";
import {
  CreateExecutionOrderSchema,
  ExecutionOrderListQuerySchema,
  UpdateExecutionOrderSchema,
} from "@naisys-erp/shared";
import prisma from "../db.js";
import {
  execOrderItemLinks,
  execOrderItemActions,
  paginationLinks,
  selfLink,
} from "../hateoas.js";

const RESOURCE = "execution/orders";

const IdParamsSchema = z.object({
  id: z.coerce.number().int(),
});

function formatDate(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function formatItem(item: {
  id: number;
  order_no: number;
  plan_order_id: number;
  plan_order_rev_id: number;
  status: string;
  priority: string;
  scheduled_start_at: Date | null;
  due_at: Date | null;
  released_at: Date;
  started_at: Date | null;
  closed_at: Date | null;
  assigned_to: string | null;
  notes: string | null;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}) {
  return {
    id: item.id,
    orderNo: item.order_no,
    planOrderId: item.plan_order_id,
    planOrderRevId: item.plan_order_rev_id,
    status: item.status,
    priority: item.priority,
    scheduledStartAt: formatDate(item.scheduled_start_at),
    dueAt: formatDate(item.due_at),
    releasedAt: item.released_at.toISOString(),
    startedAt: formatDate(item.started_at),
    closedAt: formatDate(item.closed_at),
    assignedTo: item.assigned_to,
    notes: item.notes,
    createdAt: item.created_at.toISOString(),
    createdBy: item.created_by,
    updatedAt: item.updated_at.toISOString(),
    updatedBy: item.updated_by,
    _links: execOrderItemLinks(item.id, item.plan_order_id),
    _actions: execOrderItemActions(item.id, item.status),
  };
}

function formatListItem(item: Parameters<typeof formatItem>[0]) {
  return {
    ...formatItem(item),
    _links: [selfLink(`/${RESOURCE}/${item.id}`)],
  };
}

export default async function executionOrderRoutes(
  fastify: FastifyInstance,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List execution orders with pagination and filtering",
      tags: ["Execution Orders"],
      querystring: ExecutionOrderListQuerySchema,
    },
    handler: async (request) => {
      const { page, pageSize, status, priority, search } = request.query;

      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (priority) where.priority = priority;
      if (search) {
        where.OR = [
          { assigned_to: { contains: search } },
          { notes: { contains: search } },
        ];
      }

      const [items, total] = await Promise.all([
        prisma.execOrder.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { created_at: "desc" },
        }),
        prisma.execOrder.count({ where }),
      ]);

      return {
        items: items.map(formatListItem),
        total,
        page,
        pageSize,
        _links: [
          ...paginationLinks(RESOURCE, page, pageSize, total),
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
        createdBy,
      } = request.body;

      // Validate planning order exists
      const planOrder = await prisma.planningOrder.findUnique({
        where: { id: planOrderId },
      });
      if (!planOrder) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Planning order ${planOrderId} not found`,
        };
      }

      // Validate revision exists and belongs to the planning order
      const planOrderRev = await prisma.planningOrderRevision.findFirst({
        where: { id: planOrderRevId, plan_order_id: planOrderId },
      });
      if (!planOrderRev) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Planning order revision ${planOrderRevId} not found for order ${planOrderId}`,
        };
      }

      // Auto-increment order_no
      const maxOrder = await prisma.execOrder.findFirst({
        where: { plan_order_id: planOrderId },
        orderBy: { order_no: "desc" },
        select: { order_no: true },
      });
      const nextOrderNo = (maxOrder?.order_no ?? 0) + 1;

      const item = await prisma.execOrder.create({
        data: {
          order_no: nextOrderNo,
          plan_order_id: planOrderId,
          plan_order_rev_id: planOrderRevId,
          priority,
          scheduled_start_at: scheduledStartAt
            ? new Date(scheduledStartAt)
            : null,
          due_at: dueAt ? new Date(dueAt) : null,
          assigned_to: assignedTo ?? null,
          notes: notes ?? null,
          created_by: createdBy,
          updated_by: createdBy,
        },
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
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const item = await prisma.execOrder.findUnique({ where: { id } });
      if (!item) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Execution order ${id} not found`,
        };
      }

      return formatItem(item);
    },
  });

  // UPDATE (released/started only)
  app.put("/:id", {
    schema: {
      description: "Update an execution order (released or started status only)",
      tags: ["Execution Orders"],
      params: IdParamsSchema,
      body: UpdateExecutionOrderSchema,
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { updatedBy, ...data } = request.body;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Execution order ${id} not found`,
        };
      }

      if (existing.status !== "released" && existing.status !== "started") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot update execution order in ${existing.status} status`,
        };
      }

      const updateData: Record<string, unknown> = { updated_by: updatedBy };
      if (data.priority !== undefined) updateData.priority = data.priority;
      if (data.assignedTo !== undefined) updateData.assigned_to = data.assignedTo;
      if (data.notes !== undefined) updateData.notes = data.notes;
      if (data.scheduledStartAt !== undefined) {
        updateData.scheduled_start_at = data.scheduledStartAt
          ? new Date(data.scheduledStartAt)
          : null;
      }
      if (data.dueAt !== undefined) {
        updateData.due_at = data.dueAt ? new Date(data.dueAt) : null;
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
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Execution order ${id} not found`,
        };
      }

      if (existing.status !== "released") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot delete execution order in ${existing.status} status`,
        };
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
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Execution order ${id} not found`,
        };
      }

      if (existing.status !== "released") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot start execution order in ${existing.status} status`,
        };
      }

      const item = await prisma.execOrder.update({
        where: { id },
        data: {
          status: "started",
          started_at: new Date(),
        },
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
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Execution order ${id} not found`,
        };
      }

      if (existing.status !== "started") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot close execution order in ${existing.status} status`,
        };
      }

      const item = await prisma.execOrder.update({
        where: { id },
        data: {
          status: "closed",
          closed_at: new Date(),
        },
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
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const existing = await prisma.execOrder.findUnique({ where: { id } });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Execution order ${id} not found`,
        };
      }

      if (existing.status !== "released" && existing.status !== "started") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot cancel execution order in ${existing.status} status`,
        };
      }

      const item = await prisma.execOrder.update({
        where: { id },
        data: { status: "cancelled" },
      });

      return formatItem(item);
    },
  });
}
