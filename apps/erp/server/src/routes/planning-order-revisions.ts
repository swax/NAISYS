import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";
import {
  CreatePlanningOrderRevisionSchema,
  ErrorResponseSchema,
  PlanningOrderRevisionListQuerySchema,
  PlanningOrderRevisionListResponseSchema,
  PlanningOrderRevisionSchema,
  UpdatePlanningOrderRevisionSchema,
  type RevisionStatus,
} from "@naisys-erp/shared";
import { writeAuditEntry } from "../audit.js";
import prisma from "../db.js";
import { sendError } from "../error-handler.js";
import {
  revisionItemLinks,
  revisionItemActions,
  paginationLinks,
  selfLink,
} from "../hateoas.js";
import type { PlanningOrderRevisionModel } from "../generated/prisma/models/PlanningOrderRevision.js";

const PARENT_RESOURCE = "planning/orders";

const OrderIdParamsSchema = z.object({
  orderId: z.coerce.number().int(),
});

const RevisionIdParamsSchema = z.object({
  orderId: z.coerce.number().int(),
  revisionId: z.coerce.number().int(),
});

function formatItem(orderId: number, item: PlanningOrderRevisionModel) {
  return {
    id: item.id,
    planOrderId: item.planOrderId,
    revNo: item.revNo,
    status: item.status as RevisionStatus,
    notes: item.notes,
    changeSummary: item.changeSummary,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdById,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedById,
    _links: revisionItemLinks(PARENT_RESOURCE, orderId, item.id),
    _actions: revisionItemActions(
      PARENT_RESOURCE,
      orderId,
      item.id,
      item.status,
    ),
  };
}

function formatListItem(orderId: number, item: PlanningOrderRevisionModel) {
  return {
    ...formatItem(orderId, item),
    _links: [selfLink(`/${PARENT_RESOURCE}/${orderId}/revisions/${item.id}`)],
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
      response: {
        200: PlanningOrderRevisionListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderId } = request.params;
      const { page, pageSize, status } = request.query;

      const order = await ensureOrderExists(orderId);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Planning order ${orderId} not found`,
        );
      }

      const where: Record<string, unknown> = { planOrderId: orderId };
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        prisma.planningOrderRevision.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { revNo: "desc" },
        }),
        prisma.planningOrderRevision.count({ where }),
      ]);

      return {
        items: items.map((item) => formatListItem(orderId, item)),
        total,
        page,
        pageSize,
        _links: paginationLinks(
          `${PARENT_RESOURCE}/${orderId}/revisions`,
          page,
          pageSize,
          total,
          { status },
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
      response: {
        201: PlanningOrderRevisionSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderId } = request.params;
      const { notes, changeSummary } = request.body;
      const userId = request.erpUser!.id;

      const order = await ensureOrderExists(orderId);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Planning order ${orderId} not found`,
        );
      }

      // Auto-increment revNo inside a transaction to prevent race conditions
      const item = await prisma.$transaction(async (tx) => {
        const maxRev = await tx.planningOrderRevision.findFirst({
          where: { planOrderId: orderId },
          orderBy: { revNo: "desc" },
          select: { revNo: true },
        });
        const nextRevNo = (maxRev?.revNo ?? 0) + 1;

        return tx.planningOrderRevision.create({
          data: {
            planOrderId: orderId,
            revNo: nextRevNo,
            notes: notes ?? null,
            changeSummary: changeSummary ?? null,
            createdById: userId,
            updatedById: userId,
          },
        });
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
      response: {
        200: PlanningOrderRevisionSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;

      const item = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, planOrderId: orderId },
      });
      if (!item) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revisionId} not found for order ${orderId}`,
        );
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
      response: {
        200: PlanningOrderRevisionSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;
      const { notes, changeSummary } = request.body;
      const userId = request.erpUser!.id;

      const existing = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, planOrderId: orderId },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revisionId} not found for order ${orderId}`,
        );
      }

      if (existing.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot update revision in ${existing.status} status`,
        );
      }

      const item = await prisma.planningOrderRevision.update({
        where: { id: revisionId },
        data: {
          ...(notes !== undefined ? { notes } : {}),
          ...(changeSummary !== undefined ? { changeSummary } : {}),
          updatedById: userId,
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
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;

      const existing = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, planOrderId: orderId },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revisionId} not found for order ${orderId}`,
        );
      }

      if (existing.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot delete revision in ${existing.status} status`,
        );
      }

      const execOrderCount = await prisma.execOrder.count({
        where: { planOrderRevId: revisionId },
      });
      if (execOrderCount > 0) {
        return sendError(
          reply,
          409,
          "Conflict",
          "Cannot delete revision with existing execution orders.",
        );
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
      response: {
        200: PlanningOrderRevisionSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;

      const existing = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, planOrderId: orderId },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revisionId} not found for order ${orderId}`,
        );
      }

      if (existing.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot approve revision in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.planningOrderRevision.update({
          where: { id: revisionId },
          data: { status: "approved", updatedById: userId },
        });
        await writeAuditEntry(
          tx,
          "PlanningOrderRevision",
          revisionId,
          "approve",
          "status",
          "draft",
          "approved",
          userId,
        );
        return updated;
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
      response: {
        200: PlanningOrderRevisionSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderId, revisionId } = request.params;

      const existing = await prisma.planningOrderRevision.findFirst({
        where: { id: revisionId, planOrderId: orderId },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revisionId} not found for order ${orderId}`,
        );
      }

      if (existing.status !== "approved") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot mark revision as obsolete from ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.planningOrderRevision.update({
          where: { id: revisionId },
          data: { status: "obsolete", updatedById: userId },
        });
        await writeAuditEntry(
          tx,
          "PlanningOrderRevision",
          revisionId,
          "obsolete",
          "status",
          "approved",
          "obsolete",
          userId,
        );
        return updated;
      });

      return formatItem(orderId, item);
    },
  });
}
