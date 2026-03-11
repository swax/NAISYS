import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateOrderRevisionSchema,
  ErrorResponseSchema,
  OrderRevisionListQuerySchema,
  OrderRevisionListResponseSchema,
  OrderRevisionSchema,
  type RevisionStatus,
  UpdateOrderRevisionSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { writeAuditEntry } from "../audit.js";
import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import type { OrderRevisionModel } from "../generated/prisma/models/OrderRevision.js";
import {
  API_PREFIX,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";

function revisionItemLinks(
  parentResource: string,
  orderKey: string,
  revNo: number,
): HateoasLink[] {
  const basePath = `/${parentResource}/${orderKey}/revs`;
  return [
    selfLink(`${basePath}/${revNo}`),
    {
      rel: "collection",
      href: `${API_PREFIX}${basePath}`,
      title: "Revisions",
    },
    {
      rel: "parent",
      href: `${API_PREFIX}/${parentResource}/${orderKey}`,
      title: "Order",
    },
    schemaLink("OrderRevision"),
  ];
}

function revisionItemActions(
  parentResource: string,
  orderKey: string,
  revNo: number,
  status: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "manage_orders")) return [];
  const href = `${API_PREFIX}/${parentResource}/${orderKey}/revs/${revNo}`;
  const actions: HateoasAction[] = [];

  if (status === "draft") {
    actions.push(
      {
        rel: "update",
        href,
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/schemas/UpdateOrderRevision`,
      },
      {
        rel: "approve",
        href: `${href}/approve`,
        method: "POST",
        title: "Approve",
      },
      {
        rel: "delete",
        href,
        method: "DELETE",
        title: "Delete",
      },
    );
  } else if (status === "approved") {
    if (hasPermission(user, "manage_runs")) {
      actions.push({
        rel: "cut-order",
        href: `${API_PREFIX}/orders/${orderKey}/runs`,
        method: "POST",
        title: "Cut Order",
        schema: `${API_PREFIX}/schemas/CreateOrderRun`,
      });
    }
    actions.push({
      rel: "obsolete",
      href: `${href}/obsolete`,
      method: "POST",
      title: "Mark Obsolete",
    });
  }
  // obsolete: no actions

  return actions;
}

const includeUsers = {
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

type RevisionWithUsers = OrderRevisionModel & {
  createdBy: { username: string };
  updatedBy: { username: string };
};

const PARENT_RESOURCE = "orders";

const OrderKeyParamsSchema = z.object({
  orderKey: z.string(),
});

const RevNoParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
});

function formatItem(
  orderKey: string,
  user: ErpUser | undefined,
  item: RevisionWithUsers,
) {
  return {
    id: item.id,
    orderId: item.orderId,
    revNo: item.revNo,
    status: item.status as RevisionStatus,
    notes: item.notes,
    changeSummary: item.changeSummary,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy.username,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedBy.username,
    _links: revisionItemLinks(PARENT_RESOURCE, orderKey, item.revNo),
    _actions: revisionItemActions(
      PARENT_RESOURCE,
      orderKey,
      item.revNo,
      item.status,
      user,
    ),
  };
}

function formatListItem(
  orderKey: string,
  user: ErpUser | undefined,
  item: RevisionWithUsers,
) {
  return {
    ...formatItem(orderKey, user, item),
    _links: [selfLink(`/${PARENT_RESOURCE}/${orderKey}/revs/${item.revNo}`)],
  };
}

async function resolveOrder(orderKey: string) {
  return erpDb.order.findUnique({
    where: { key: orderKey },
  });
}

async function findRevision(orderId: number, revNo: number) {
  return erpDb.orderRevision.findFirst({
    where: { orderId, revNo },
    include: includeUsers,
  });
}

export default function orderRevisionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List revisions for an order",
      tags: ["Order Revisions"],
      params: OrderKeyParamsSchema,
      querystring: OrderRevisionListQuerySchema,
      response: {
        200: OrderRevisionListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const { page, pageSize, status } = request.query;

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

      const [items, total] = await Promise.all([
        erpDb.orderRevision.findMany({
          where,
          include: includeUsers,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { revNo: "desc" },
        }),
        erpDb.orderRevision.count({ where }),
      ]);

      const revBasePath = `${PARENT_RESOURCE}/${orderKey}/revs`;
      return {
        items: items.map((item) =>
          formatListItem(orderKey, request.erpUser, item),
        ),
        total,
        page,
        pageSize,
        _links: paginationLinks(revBasePath, page, pageSize, total, { status }),
        _actions: hasPermission(request.erpUser, "manage_orders")
          ? [
              {
                rel: "create",
                href: `${API_PREFIX}/${revBasePath}`,
                method: "POST" as const,
                title: "New Revision",
                schema: `${API_PREFIX}/schemas/CreateOrderRevision`,
              },
            ]
          : [],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new revision for an order",
      tags: ["Order Revisions"],
      params: OrderKeyParamsSchema,
      body: CreateOrderRevisionSchema,
      response: {
        201: OrderRevisionSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const { notes, changeSummary } = request.body;
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

      // Auto-increment revNo and copy previous revision's structure
      const item = await erpDb.$transaction(async (erpTx) => {
        const prevRev = await erpTx.orderRevision.findFirst({
          where: { orderId: order.id },
          orderBy: { revNo: "desc" },
          include: {
            operations: {
              include: {
                steps: {
                  include: { fields: true },
                },
              },
            },
          },
        });
        const nextRevNo = (prevRev?.revNo ?? 0) + 1;

        const newRev = await erpTx.orderRevision.create({
          data: {
            orderId: order.id,
            revNo: nextRevNo,
            notes: notes ?? null,
            changeSummary: changeSummary ?? null,
            createdById: userId,
            updatedById: userId,
          },
          include: includeUsers,
        });

        // Copy operations, steps, and fields from the previous revision
        if (prevRev) {
          for (const op of prevRev.operations) {
            const newOp = await erpTx.operation.create({
              data: {
                orderRevId: newRev.id,
                seqNo: op.seqNo,
                title: op.title,
                description: op.description,
                createdById: userId,
                updatedById: userId,
              },
            });

            for (const step of op.steps) {
              const newStep = await erpTx.step.create({
                data: {
                  operationId: newOp.id,
                  seqNo: step.seqNo,
                  instructions: step.instructions,
                  createdById: userId,
                  updatedById: userId,
                },
              });

              for (const field of step.fields) {
                await erpTx.stepField.create({
                  data: {
                    stepId: newStep.id,
                    seqNo: field.seqNo,
                    label: field.label,
                    type: field.type,
                    required: field.required,
                    createdById: userId,
                    updatedById: userId,
                  },
                });
              }
            }
          }
        }

        return newRev;
      });

      reply.status(201);
      return formatItem(orderKey, request.erpUser, item);
    },
  });

  // GET by revNo
  app.get("/:revNo", {
    schema: {
      description: "Get a single revision by revision number",
      tags: ["Order Revisions"],
      params: RevNoParamsSchema,
      response: {
        200: OrderRevisionSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const item = await findRevision(order.id, revNo);
      if (!item) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revNo} not found for order '${orderKey}'`,
        );
      }

      return formatItem(orderKey, request.erpUser, item);
    },
  });

  // UPDATE (draft only)
  app.put("/:revNo", {
    schema: {
      description: "Update a revision (draft status only)",
      tags: ["Order Revisions"],
      params: RevNoParamsSchema,
      body: UpdateOrderRevisionSchema,
      response: {
        200: OrderRevisionSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;
      const { notes, changeSummary } = request.body;
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

      const existing = await findRevision(order.id, revNo);
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revNo} not found for order '${orderKey}'`,
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

      const item = await erpDb.orderRevision.update({
        where: { id: existing.id },
        data: {
          ...(notes !== undefined ? { notes } : {}),
          ...(changeSummary !== undefined ? { changeSummary } : {}),
          updatedById: userId,
        },
        include: includeUsers,
      });

      return formatItem(orderKey, request.erpUser, item);
    },
  });

  // DELETE (draft only)
  app.delete("/:revNo", {
    schema: {
      description: "Delete a revision (draft status only)",
      tags: ["Order Revisions"],
      params: RevNoParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const existing = await findRevision(order.id, revNo);
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revNo} not found for order '${orderKey}'`,
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

      const orderRunCount = await erpDb.orderRun.count({
        where: { orderRevId: existing.id },
      });
      if (orderRunCount > 0) {
        return sendError(
          reply,
          409,
          "Conflict",
          "Cannot delete revision with existing order runs.",
        );
      }

      await erpDb.orderRevision.delete({ where: { id: existing.id } });
      reply.status(204);
    },
  });

  // APPROVE (draft → approved)
  app.post("/:revNo/approve", {
    schema: {
      description: "Approve a draft revision",
      tags: ["Order Revisions"],
      params: RevNoParamsSchema,
      response: {
        200: OrderRevisionSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const existing = await findRevision(order.id, revNo);
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revNo} not found for order '${orderKey}'`,
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
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.orderRevision.update({
          where: { id: existing.id },
          data: { status: "approved", updatedById: userId },
          include: includeUsers,
        });
        await writeAuditEntry(
          erpTx,
          "OrderRevision",
          existing.id,
          "approve",
          "status",
          "draft",
          "approved",
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, request.erpUser, item);
    },
  });

  // OBSOLETE (approved → obsolete)
  app.post("/:revNo/obsolete", {
    schema: {
      description: "Mark an approved revision as obsolete",
      tags: ["Order Revisions"],
      params: RevNoParamsSchema,
      response: {
        200: OrderRevisionSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Order '${orderKey}' not found`,
        );
      }

      const existing = await findRevision(order.id, revNo);
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Revision ${revNo} not found for order '${orderKey}'`,
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
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.orderRevision.update({
          where: { id: existing.id },
          data: { status: "obsolete", updatedById: userId },
          include: includeUsers,
        });
        await writeAuditEntry(
          erpTx,
          "OrderRevision",
          existing.id,
          "obsolete",
          "status",
          "approved",
          "obsolete",
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, request.erpUser, item);
    },
  });
}
