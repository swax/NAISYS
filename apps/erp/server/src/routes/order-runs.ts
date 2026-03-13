import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateOrderRunSchema,
  ErrorResponseSchema,
  OrderRunListQuerySchema,
  OrderRunListResponseSchema,
  OrderRunSchema,
  OrderRunStatus,
  UpdateOrderRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, paginationLinks, selfLink } from "../hateoas.js";
import {
  childItemLinks,
  formatAuditFields,
  formatDate,
  resolveOrder,
} from "../route-helpers.js";
import {
  createOrderRun,
  deleteOrderRun,
  findExisting,
  findOrderRevision,
  getOrderRun,
  listOrderRuns,
  type OrderRunWithRev,
  updateOrderRun,
  validateStatusFor,
} from "../services/order-run-service.js";

function runResource(orderKey: string) {
  return `orders/${orderKey}/runs`;
}

function orderRunItemActions(
  orderKey: string,
  id: number,
  status: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  const href = `${API_PREFIX}/${runResource(orderKey)}/${id}`;
  const actions: HateoasAction[] = [];
  const isExecutor = hasPermission(user, "order_executor");
  const isManager = hasPermission(user, "order_manager");

  if (status === OrderRunStatus.released) {
    if (isExecutor) {
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
      );
    }
    if (isManager) {
      actions.push(
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
    }
  } else if (status === OrderRunStatus.started) {
    if (isExecutor) {
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
      );
    }
    if (isManager) {
      actions.push({
        rel: "cancel",
        href: `${href}/cancel`,
        method: "POST",
        title: "Cancel",
      });
    }
  } else if (
    status === OrderRunStatus.closed ||
    status === OrderRunStatus.cancelled
  ) {
    if (isManager) {
      actions.push({
        rel: "reopen",
        href: `${href}/reopen`,
        method: "POST",
        title: "Reopen",
      });
    }
  }

  return actions;
}

const OrderKeyParamsSchema = z.object({
  orderKey: z.string(),
});

export const IdParamsSchema = z.object({
  orderKey: z.string(),
  id: z.coerce.number().int(),
});

export function formatRun(
  orderKey: string,
  user: ErpUser | undefined,
  run: OrderRunWithRev,
) {
  return {
    id: run.id,
    runNo: run.runNo,
    orderId: run.orderId,
    orderKey,
    revNo: run.orderRev.revNo,
    itemKey: run.order?.item?.key ?? null,
    status: run.status,
    priority: run.priority,
    scheduledStartAt: formatDate(run.scheduledStartAt),
    dueAt: formatDate(run.dueAt),
    assignedTo: run.assignedTo,
    notes: run.notes,
    ...formatAuditFields(run),
    _links: [
      ...childItemLinks(
        "/" + runResource(orderKey),
        run.id,
        "Runs",
        "/orders/" + orderKey,
        "Order",
        "OrderRun",
        "order",
      ),
      {
        rel: "operations",
        href: `${API_PREFIX}/${runResource(orderKey)}/${run.id}/ops`,
        title: "Operation Runs",
      } as HateoasLink,
    ],
    _actions: orderRunItemActions(orderKey, run.id, run.status, user),
  };
}

function formatListRun(
  orderKey: string,
  user: ErpUser | undefined,
  run: OrderRunWithRev,
) {
  const { _actions, ...rest } = formatRun(orderKey, user, run);
  return {
    ...rest,
    _links: [selfLink(`/${runResource(orderKey)}/${run.id}`)],
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
        return notFound(reply, `Order '${orderKey}' not found`);
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

      const { items, total } = await listOrderRuns(where, page, pageSize);

      const resource = runResource(orderKey);

      return {
        items: items.map((run) =>
          formatListRun(orderKey, request.erpUser, run),
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

  // CREATE (cut order)
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
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const { revNo, priority, scheduledStartAt, dueAt, assignedTo, notes } =
        request.body;
      const userId = request.erpUser!.id;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const orderId = order.id;

      // Validate revision exists and belongs to the order
      const orderRev = await findOrderRevision(orderId, revNo);
      if (!orderRev) {
        return notFound(
          reply,
          `Order revision ${revNo} not found for order '${orderKey}'`,
        );
      }

      const run = await createOrderRun(
        orderId,
        orderRev.id,
        { priority, scheduledStartAt, dueAt, assignedTo, notes },
        userId,
      );

      reply.status(201);
      return formatRun(orderKey, request.erpUser, run);
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
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const run = await getOrderRun(id);
      if (!run || run.orderId !== order.id) {
        return notFound(
          reply,
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      return formatRun(orderKey, request.erpUser, run);
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
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, id } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const existing = await findExisting(id, order.id);
      if (!existing) {
        return notFound(
          reply,
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      const statusErr = validateStatusFor("update", existing.status, [
        OrderRunStatus.released,
        OrderRunStatus.started,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const run = await updateOrderRun(id, data, userId);

      return formatRun(orderKey, request.erpUser, run);
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
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey, id } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const existing = await findExisting(id, order.id);
      if (!existing) {
        return notFound(
          reply,
          `Order run ${id} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== OrderRunStatus.released) {
        return conflict(
          reply,
          `Cannot delete order run in ${existing.status} status`,
        );
      }

      await deleteOrderRun(id);
      reply.status(204);
    },
  });
}
