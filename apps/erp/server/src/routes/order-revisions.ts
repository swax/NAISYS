import type { HateoasAction } from "@naisys/common";
import type { HateoasLink } from "@naisys/common";
import {
  CreateOrderRevisionSchema,
  ErrorResponseSchema,
  MutateResponseSchema,
  OrderRevisionListQuerySchema,
  OrderRevisionListResponseSchema,
  OrderRevisionSchema,
  RevisionCreateResponseSchema,
  RevisionDiffQuerySchema,
  RevisionDiffResponseSchema,
  RevisionStatus,
  UpdateOrderRevisionSchema,
} from "@naisys-erp/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, paginationLinks } from "../hateoas.js";
import {
  childItemLinks,
  formatAuditFields,
  mutationResult,
  permGate,
  resolveActions,
  resolveOrder,
} from "../route-helpers.js";
import {
  checkHasOrderRuns,
  createRevision,
  deleteRevision,
  findExisting,
  getRevision,
  getRevisionOpSummary,
  listRevisions,
  type OrderRevisionWithRelations,
  updateRevision,
  validateDraftStatus,
} from "../services/order-revision-service.js";
import { diffRevisions } from "../services/revision-diff-service.js";

export function revisionItemActions(
  parentResource: string,
  orderKey: string,
  revNo: number,
  status: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  const href = `${API_PREFIX}/${parentResource}/${orderKey}/revs/${revNo}`;

  return resolveActions(
    [
      {
        rel: "update",
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/schemas/UpdateOrderRevision`,
        permission: "order_planner",
        statuses: [RevisionStatus.draft, RevisionStatus.approved],
        disabledWhen: (ctx) =>
          ctx.status === RevisionStatus.approved
            ? "Revision is no longer in draft"
            : null,
      },
      {
        rel: "approve",
        path: "/approve",
        method: "POST",
        title: "Approve",
        permission: "order_planner",
        statuses: [RevisionStatus.draft, RevisionStatus.approved],
        disabledWhen: (ctx) =>
          ctx.status === RevisionStatus.approved
            ? "Revision has already been approved"
            : null,
      },
      {
        rel: "delete",
        method: "DELETE",
        title: "Delete",
        permission: "order_planner",
        statuses: [RevisionStatus.draft],
        hideWithoutPermission: true,
      },
      {
        rel: "cut-order",
        href: `${API_PREFIX}/orders/${orderKey}/runs`,
        method: "POST",
        title: "Cut Order",
        schema: `${API_PREFIX}/schemas/CreateOrderRun`,
        permission: "order_manager",
        statuses: [RevisionStatus.draft, RevisionStatus.approved],
        disabledWhen: (ctx) =>
          ctx.status === RevisionStatus.draft
            ? "Revision must be approved before cutting an order run"
            : null,
      },
      {
        rel: "obsolete",
        path: "/obsolete",
        method: "POST",
        title: "Mark Obsolete",
        permission: "order_planner",
        statuses: [RevisionStatus.draft, RevisionStatus.approved],
        disabledWhen: (ctx) =>
          ctx.status === RevisionStatus.draft
            ? "Revision must be approved before marking obsolete"
            : null,
      },
    ],
    href,
    { status, user },
  );
}

const PARENT_RESOURCE = "orders";

const OrderKeyParamsSchema = z.object({
  orderKey: z.string(),
});

export const RevNoParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
});

export async function formatRevision(
  orderKey: string,
  user: ErpUser | undefined,
  revision: OrderRevisionWithRelations,
) {
  const opSummaryRows = await getRevisionOpSummary(revision.id);
  return {
    id: revision.id,
    orderId: revision.orderId,
    revNo: revision.revNo,
    status: revision.status,
    description: revision.description,
    changeSummary: revision.changeSummary,
    itemKey: revision.order?.item?.key ?? null,
    operationSummary: opSummaryRows.map((op) => ({
      seqNo: op.seqNo,
      title: op.title,
    })),
    ...formatAuditFields(revision),
    _links: [
      ...childItemLinks(
        `/${PARENT_RESOURCE}/${orderKey}/revs`,
        revision.revNo,
        "Revisions",
        `/${PARENT_RESOURCE}/${orderKey}`,
        "Order",
        "OrderRevision",
      ),
      {
        rel: "operations",
        href: `${API_PREFIX}/${PARENT_RESOURCE}/${orderKey}/revs/${revision.revNo}/ops`,
        title: "Operations",
      } as HateoasLink,
    ],
    _actions: revisionItemActions(
      PARENT_RESOURCE,
      orderKey,
      revision.revNo,
      revision.status,
      user,
    ),
  };
}

function formatListRevision(
  orderKey: string,
  user: ErpUser | undefined,
  revision: OrderRevisionWithRelations,
) {
  return {
    id: revision.id,
    orderId: revision.orderId,
    revNo: revision.revNo,
    status: revision.status,
    description: revision.description,
    changeSummary: revision.changeSummary,
    itemKey: revision.order?.item?.key ?? null,
    ...formatAuditFields(revision),
    _actions: revisionItemActions(
      PARENT_RESOURCE,
      orderKey,
      revision.revNo,
      revision.status,
      user,
    ),
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
      const { page, pageSize, status, includeObsolete } = request.query;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const where: Record<string, unknown> = {};
      if (status) {
        where.status = status;
      } else if (!includeObsolete) {
        where.status = { not: RevisionStatus.obsolete };
      }

      const [items, total] = await listRevisions(
        order.id,
        where,
        page,
        pageSize,
      );

      const revBasePath = `${PARENT_RESOURCE}/${orderKey}/revs`;
      return {
        items: items.map((revision) =>
          formatListRevision(orderKey, request.erpUser, revision),
        ),
        total,
        page,
        pageSize,
        _links: paginationLinks(revBasePath, page, pageSize, total, {
          status,
          includeObsolete: includeObsolete ? "true" : undefined,
        }),
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}/orders/${orderKey}/revs/{revNo}`,
          },
        ],
        _actions: [
          {
            rel: "create",
            href: `${API_PREFIX}/${revBasePath}`,
            method: "POST" as const,
            title: "New Revision",
            schema: `${API_PREFIX}/schemas/CreateOrderRevision`,
            ...permGate(
              hasPermission(request.erpUser, "order_planner"),
              "order_planner",
            ),
          },
        ],
      };
    },
  });

  // DIFF two revisions
  app.get("/diff", {
    schema: {
      description: "Compare two revisions and return a structured diff",
      tags: ["Order Revisions"],
      params: OrderKeyParamsSchema,
      querystring: RevisionDiffQuerySchema,
      response: {
        200: RevisionDiffResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const { from, to } = request.query;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const diff = await diffRevisions(order.id, from, to);
      if (!diff) {
        return notFound(
          reply,
          `One or both revisions not found (rev ${from}, rev ${to})`,
        );
      }

      return diff;
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
        201: RevisionCreateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const { description, changeSummary } = request.body;
      const userId = request.erpUser!.id;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const revision = await createRevision(
        order.id,
        { description, changeSummary },
        userId,
      );

      const full = await formatRevision(orderKey, request.erpUser, revision);
      reply.status(201);
      return mutationResult(request, reply, full, {
        id: full.id,
        revNo: full.revNo,
        _links: full._links,
        _actions: full._actions,
      });
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

      const revision = await getRevision(order.id, revNo);
      if (!revision) {
        return notFound(
          reply,
          `Revision ${revNo} not found for order '${orderKey}'`,
        );
      }

      return await formatRevision(orderKey, request.erpUser, revision);
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
        200: MutateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;
      const { description, changeSummary } = request.body;
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

      const revision = await updateRevision(
        existing.id,
        { description, changeSummary },
        userId,
      );

      const full = await formatRevision(orderKey, request.erpUser, revision);
      return mutationResult(request, reply, full, {
        _actions: full._actions,
      });
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
    preHandler: requirePermission("order_planner"),
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
