import type { HateoasAction } from "@naisys/common";
import {
  CreateOrderRevisionSchema,
  ErrorResponseSchema,
  OrderRevisionListQuerySchema,
  OrderRevisionListResponseSchema,
  OrderRevisionSchema,
  RevisionStatus,
  UpdateOrderRevisionSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, paginationLinks, selfLink } from "../hateoas.js";
import {
  childItemLinks,
  formatAuditFields,
  resolveOrder,
} from "../route-helpers.js";
import {
  checkHasOrderRuns,
  createRevision,
  deleteRevision,
  findExisting,
  getRevision,
  listRevisions,
  type OrderRevisionWithUsers,
  updateRevision,
  validateDraftStatus,
} from "../services/order-revision-service.js";

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

  if (status === RevisionStatus.draft) {
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
  } else if (status === RevisionStatus.approved) {
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

const PARENT_RESOURCE = "orders";

const OrderKeyParamsSchema = z.object({
  orderKey: z.string(),
});

export const RevNoParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
});

export function formatItem(
  orderKey: string,
  user: ErpUser | undefined,
  item: OrderRevisionWithUsers,
) {
  return {
    id: item.id,
    orderId: item.orderId,
    revNo: item.revNo,
    status: item.status,
    notes: item.notes,
    changeSummary: item.changeSummary,
    ...formatAuditFields(item),
    _links: childItemLinks(
      `/${PARENT_RESOURCE}/${orderKey}/revs`,
      item.revNo,
      "Revisions",
      `/${PARENT_RESOURCE}/${orderKey}`,
      "Order",
      "OrderRevision",
    ),
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
  item: OrderRevisionWithUsers,
) {
  return {
    ...formatItem(orderKey, user, item),
    _links: [selfLink(`/${PARENT_RESOURCE}/${orderKey}/revs/${item.revNo}`)],
  };
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
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const where: Record<string, unknown> = {};
      if (status) where.status = status;

      const [items, total] = await listRevisions(
        order.id,
        where,
        page,
        pageSize,
      );

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
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const item = await createRevision(
        order.id,
        { notes, changeSummary },
        userId,
      );

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
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const item = await getRevision(order.id, revNo);
      if (!item) {
        return notFound(
          reply,
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
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const existing = await findExisting(order.id, revNo);
      if (!existing) {
        return notFound(
          reply,
          `Revision ${revNo} not found for order '${orderKey}'`,
        );
      }

      const statusError = validateDraftStatus(existing.status);
      if (statusError) {
        return conflict(reply, statusError);
      }

      const item = await updateRevision(
        existing.id,
        { notes, changeSummary },
        userId,
      );

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
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const existing = await findExisting(order.id, revNo);
      if (!existing) {
        return notFound(
          reply,
          `Revision ${revNo} not found for order '${orderKey}'`,
        );
      }

      const statusError = validateDraftStatus(existing.status);
      if (statusError) {
        return conflict(reply, statusError);
      }

      const runsError = await checkHasOrderRuns(existing.id);
      if (runsError) {
        return conflict(reply, runsError);
      }

      await deleteRevision(existing.id);
      reply.status(204);
    },
  });
}
