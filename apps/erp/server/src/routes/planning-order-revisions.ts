import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";
import {
  CreatePlanningOrderRevisionSchema,
  PlanningOrderRevisionListQuerySchema,
  UpdatePlanningOrderRevisionSchema,
} from "@naisys-erp/shared";
import prisma from "../db.js";
import {
  revisionItemLinks,
  revisionItemActions,
  revisionPaginationLinks,
  selfLink,
} from "../hateoas.js";

const PARENT_RESOURCE = "planning/orders";

const OrderIdParamsSchema = z.object({
  orderId: z.coerce.number().int(),
});

const RevisionIdParamsSchema = z.object({
  orderId: z.coerce.number().int(),
  revisionId: z.coerce.number().int(),
});

function formatItem(
  orderId: number,
  item: {
    id: number;
    plan_order_id: number;
    rev_no: number;
    status: string;
    notes: string | null;
    change_summary: string | null;
    created_at: Date;
    approved_at: Date | null;
  },
) {
  return {
    id: item.id,
    planOrderId: item.plan_order_id,
    revNo: item.rev_no,
    status: item.status,
    notes: item.notes,
    changeSummary: item.change_summary,
    createdAt: item.created_at.toISOString(),
    approvedAt: item.approved_at?.toISOString() ?? null,
    _links: revisionItemLinks(PARENT_RESOURCE, orderId, item.id),
    _actions: revisionItemActions(
      PARENT_RESOURCE,
      orderId,
      item.id,
      item.status,
    ),
  };
}

function formatListItem(
  orderId: number,
  item: Parameters<typeof formatItem>[1],
) {
  return {
    ...formatItem(orderId, item),
    _links: [
      selfLink(
        `/${PARENT_RESOURCE}/${orderId}/revisions/${item.id}`,
      ),
    ],
    _actions: revisionItemActions(
      PARENT_RESOURCE,
      orderId,
      item.id,
      item.status,
    ),
  };
}

async function ensureOrderExists(orderId: number) {
  const order = await prisma.planningOrder.findUnique({
    where: { id: orderId },
  });
  return order;
}

export default async function planningOrderRevisionRoutes(
  fastify: FastifyInstance,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List revisions for a planning order",
      tags: ["Planning Order Revisions"],
      params: OrderIdParamsSchema,
      querystring: PlanningOrderRevisionListQuerySchema,
    },
    handler: async (request, reply) => {
      const { orderId } = request.params;
      const { page, pageSize, status } = request.query;

      const order = await ensureOrderExists(orderId);
      if (!order) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Planning order ${orderId} not found`,
        };
      }

      const where: Record<string, unknown> = { plan_order_id: orderId };
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        prisma.planningOrderRevision.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { rev_no: "desc" },
        }),
        prisma.planningOrderRevision.count({ where }),
      ]);

      return {
        items: items.map((item) => formatListItem(orderId, item)),
        total,
        page,
        pageSize,
        _links: revisionPaginationLinks(
          PARENT_RESOURCE,
          orderId,
          page,
          pageSize,
          total,
        ),
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new revision for a planning order",
      tags: ["Planning Order Revisions"],
      params: OrderIdParamsSchema,
      body: CreatePlanningOrderRevisionSchema,
    },
    handler: async (request, reply) => {
      const { orderId } = request.params;
      const { notes, changeSummary } = request.body;

      const order = await ensureOrderExists(orderId);
      if (!order) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Planning order ${orderId} not found`,
        };
      }

      // Auto-increment rev_no
      const maxRev = await prisma.planningOrderRevision.findFirst({
        where: { plan_order_id: orderId },
        orderBy: { rev_no: "desc" },
        select: { rev_no: true },
      });
      const nextRevNo = (maxRev?.rev_no ?? 0) + 1;

      const item = await prisma.planningOrderRevision.create({
        data: {
          plan_order_id: orderId,
          rev_no: nextRevNo,
          notes: notes ?? null,
          change_summary: changeSummary ?? null,
        },
      });

      reply.status(201);
      return formatItem(orderId, item);
    },
  });

  // GET by ID
  app.get("/:revisionId", {
    schema: {
      description: "Get a single revision by ID",
      tags: ["Planning Order Revisions"],
      params: RevisionIdParamsSchema,
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;

      const item = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, plan_order_id: orderId },
      });
      if (!item) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Revision ${revisionId} not found for order ${orderId}`,
        };
      }

      return formatItem(orderId, item);
    },
  });

  // UPDATE (draft only)
  app.put("/:revisionId", {
    schema: {
      description: "Update a revision (draft status only)",
      tags: ["Planning Order Revisions"],
      params: RevisionIdParamsSchema,
      body: UpdatePlanningOrderRevisionSchema,
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;
      const { notes, changeSummary } = request.body;

      const existing = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, plan_order_id: orderId },
      });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Revision ${revisionId} not found for order ${orderId}`,
        };
      }

      if (existing.status !== "draft") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot update revision in ${existing.status} status`,
        };
      }

      const item = await prisma.planningOrderRevision.update({
        where: { id: revisionId },
        data: {
          ...(notes !== undefined ? { notes } : {}),
          ...(changeSummary !== undefined ? { change_summary: changeSummary } : {}),
        },
      });

      return formatItem(orderId, item);
    },
  });

  // DELETE (draft only)
  app.delete("/:revisionId", {
    schema: {
      description: "Delete a revision (draft status only)",
      tags: ["Planning Order Revisions"],
      params: RevisionIdParamsSchema,
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;

      const existing = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, plan_order_id: orderId },
      });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Revision ${revisionId} not found for order ${orderId}`,
        };
      }

      if (existing.status !== "draft") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot delete revision in ${existing.status} status`,
        };
      }

      await prisma.planningOrderRevision.delete({ where: { id: revisionId } });
      reply.status(204);
    },
  });

  // APPROVE (draft → approved)
  app.post("/:revisionId/approve", {
    schema: {
      description: "Approve a draft revision",
      tags: ["Planning Order Revisions"],
      params: RevisionIdParamsSchema,
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;

      const existing = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, plan_order_id: orderId },
      });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Revision ${revisionId} not found for order ${orderId}`,
        };
      }

      if (existing.status !== "draft") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot approve revision in ${existing.status} status`,
        };
      }

      const item = await prisma.planningOrderRevision.update({
        where: { id: revisionId },
        data: {
          status: "approved",
          approved_at: new Date(),
        },
      });

      return formatItem(orderId, item);
    },
  });

  // OBSOLETE (approved → obsolete)
  app.post("/:revisionId/obsolete", {
    schema: {
      description: "Mark an approved revision as obsolete",
      tags: ["Planning Order Revisions"],
      params: RevisionIdParamsSchema,
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;

      const existing = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, plan_order_id: orderId },
      });
      if (!existing) {
        reply.status(404);
        return {
          error: "Not found",
          message: `Revision ${revisionId} not found for order ${orderId}`,
        };
      }

      if (existing.status !== "approved") {
        reply.status(409);
        return {
          error: "Conflict",
          message: `Cannot mark revision as obsolete from ${existing.status} status`,
        };
      }

      const item = await prisma.planningOrderRevision.update({
        where: { id: revisionId },
        data: { status: "obsolete" },
      });

      return formatItem(orderId, item);
    },
  });
}
