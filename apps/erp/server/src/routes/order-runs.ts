import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateOrderRunSchema,
  ErrorResponseSchema,
  MutateResponseSchema,
  OrderRunListQuerySchema,
  OrderRunListResponseSchema,
  OrderRunSchema,
  OrderRunStatus,
  RunCreateResponseSchema,
  UpdateOrderRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
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
  resolveActions,
  resolveOrder,
  resolveOrderRun,
} from "../route-helpers.js";
import {
  checkOpsComplete,
  createOrderRun,
  deleteOrderRun,
  findLatestApprovedRevision,
  findOrderRevision,
  getOrderRun,
  getOrderRunOpSummary,
  listOrderRuns,
  type OrderRunWithRev,
  updateOrderRun,
  validateStatusFor,
} from "../services/order-run-service.js";

function runResource(orderKey: string) {
  return `orders/${orderKey}/runs`;
}

export async function orderRunItemActions(
  orderKey: string,
  runNo: number,
  runId: number,
  status: string,
  itemKey: string | null,
  user: ErpUser | undefined,
): Promise<HateoasAction[]> {
  const href = `${API_PREFIX}/${runResource(orderKey)}/${runNo}`;
  const isExecutor = hasPermission(user, "order_executor");
  const opsErr =
    isExecutor && status === OrderRunStatus.started
      ? await checkOpsComplete(runId)
      : null;

  return resolveActions(
    [
      {
        rel: "start",
        path: "/start",
        method: "POST",
        title: "Start",
        permission: "order_executor",
        statuses: [OrderRunStatus.released],
      },
      {
        rel: "complete",
        path: "/complete",
        method: "POST",
        title: "Complete",
        schema: `${API_PREFIX}/schemas/CompleteOrderRun`,
        permission: "order_executor",
        statuses: [OrderRunStatus.started],
        visibleWhen: (ctx) => !!ctx.itemKey,
        disabledWhen: (ctx) => ctx.opsErr,
      },
      {
        rel: "close",
        path: "/close",
        method: "POST",
        title: "Close",
        permission: "order_executor",
        statuses: [OrderRunStatus.started],
        visibleWhen: (ctx) => !ctx.itemKey,
        disabledWhen: (ctx) => ctx.opsErr,
      },
      {
        rel: "update",
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/schemas/UpdateOrderRun`,
        permission: "order_manager",
        statuses: [OrderRunStatus.released, OrderRunStatus.started],
      },
      {
        rel: "cancel",
        path: "/cancel",
        method: "POST",
        title: "Cancel",
        permission: "order_manager",
        statuses: [OrderRunStatus.released, OrderRunStatus.started],
      },
      {
        rel: "delete",
        method: "DELETE",
        title: "Delete",
        permission: "order_manager",
        statuses: [OrderRunStatus.released],
      },
      {
        rel: "reopen",
        path: "/reopen",
        method: "POST",
        title: "Reopen",
        permission: "order_manager",
        statuses: [OrderRunStatus.closed, OrderRunStatus.cancelled],
      },
    ],
    href,
    { status, user, itemKey, opsErr },
  );
}

const OrderKeyParamsSchema = z.object({
  orderKey: z.string(),
});

export const RunNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
});

export async function formatRun(
  orderKey: string,
  user: ErpUser | undefined,
  run: OrderRunWithRev,
) {
  const itemKey = run.order?.item?.key ?? null;
  const instance = run.itemInstances[0] ?? null;
  const links: HateoasLink[] = [
    ...childItemLinks(
      "/" + runResource(orderKey),
      run.runNo,
      "Runs",
      "/orders/" + orderKey,
      "Order",
      "OrderRun",
      "order",
    ),
    {
      rel: "operations",
      href: `${API_PREFIX}/${runResource(orderKey)}/${run.runNo}/ops`,
      title: "Operation Runs",
    },
  ];
  if (itemKey) {
    links.push({
      rel: "completion-fields",
      href: `${API_PREFIX}/items/${itemKey}/fields`,
      title: "Completion Fields",
    });
  }
  if (instance) {
    links.push({
      rel: "itemInstance",
      href: `${API_PREFIX}/items/${itemKey}/instances/${instance.id}`,
      title: "Item Instance",
    });
  }
  const opSummaryRows = await getOrderRunOpSummary(run.id);
  return {
    id: run.id,
    runNo: run.runNo,
    orderId: run.orderId,
    orderKey,
    revNo: run.orderRev.revNo,
    itemKey,
    instanceId: instance?.id ?? null,
    instanceKey: instance?.key ?? null,
    status: run.status,
    priority: run.priority,
    cost: run.cost,
    dueAt: run.dueAt,
    releaseNote: run.releaseNote,
    operationSummary: opSummaryRows.map((r) => ({
      seqNo: r.operation.seqNo,
      title: r.operation.title,
      status: r.status,
    })),
    ...formatAuditFields(run),
    _links: links,
    _actions: await orderRunItemActions(
      orderKey,
      run.runNo,
      run.id,
      run.status,
      itemKey,
      user,
    ),
  };
}

function formatListRun(orderKey: string, run: OrderRunWithRev) {
  const itemKey = run.order?.item?.key ?? null;
  const instance = run.itemInstances[0] ?? null;
  return {
    id: run.id,
    runNo: run.runNo,
    orderId: run.orderId,
    orderKey,
    revNo: run.orderRev.revNo,
    itemKey,
    instanceId: instance?.id ?? null,
    instanceKey: instance?.key ?? null,
    status: run.status,
    priority: run.priority,
    cost: run.cost,
    dueAt: run.dueAt,
    releaseNote: run.releaseNote,
    ...formatAuditFields(run),
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
        where.OR = [{ releaseNote: { contains: search } }];
      }

      const { items, total } = await listOrderRuns(where, page, pageSize);

      const resource = runResource(orderKey);

      return {
        items: items.map((run) => formatListRun(orderKey, run)),
        total,
        page,
        pageSize,
        _links: paginationLinks(resource, page, pageSize, total, {
          status,
          priority,
          search,
        }),
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}/orders/${orderKey}/runs/{runNo}`,
          },
        ],
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
        201: RunCreateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey } = request.params;
      const { revNo, priority, dueAt, releaseNote } = request.body;
      const userId = request.erpUser!.id;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const orderId = order.id;

      // Resolve revision: explicit revNo or latest approved
      const orderRev = revNo
        ? await findOrderRevision(orderId, revNo)
        : await findLatestApprovedRevision(orderId);
      if (!orderRev) {
        return notFound(
          reply,
          revNo
            ? `Order revision ${revNo} not found for order '${orderKey}'`
            : `No approved revision found for order '${orderKey}'`,
        );
      }

      const run = await createOrderRun(
        orderId,
        orderRev.id,
        { priority, dueAt, releaseNote },
        userId,
      );

      const full = await formatRun(orderKey, request.erpUser, run);
      reply.status(201);
      return mutationResult(request, reply, full, {
        id: full.id,
        runNo: full.runNo,
        _links: full._links,
        _actions: full._actions,
      });
    },
  });

  // GET by runNo
  app.get("/:runNo", {
    schema: {
      description: "Get a single order run by run number",
      tags: ["Order Runs"],
      params: RunNoParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runNo } = request.params;

      const resolved = await resolveOrderRun(orderKey, runNo);
      if (!resolved) {
        return notFound(reply, `Order run not found for order '${orderKey}'`);
      }

      const run = await getOrderRun(resolved.run.id);
      if (!run) {
        return notFound(reply, `Order run not found`);
      }

      return formatRun(orderKey, request.erpUser, run);
    },
  });

  // UPDATE (released/started only)
  app.put("/:runNo", {
    schema: {
      description: "Update an order run (released or started status only)",
      tags: ["Order Runs"],
      params: RunNoParamsSchema,
      body: UpdateOrderRunSchema,
      response: {
        200: MutateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey, runNo } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOrderRun(orderKey, runNo);
      if (!resolved) {
        return notFound(reply, `Order run not found for order '${orderKey}'`);
      }

      const statusErr = validateStatusFor("update", resolved.run.status, [
        OrderRunStatus.released,
        OrderRunStatus.started,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const run = await updateOrderRun(resolved.run.id, data, userId);

      const full = await formatRun(orderKey, request.erpUser, run);
      return mutationResult(request, reply, full, {
        _actions: full._actions,
      });
    },
  });

  // DELETE (released only)
  app.delete("/:runNo", {
    schema: {
      description: "Delete an order run (released status only)",
      tags: ["Order Runs"],
      params: RunNoParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey, runNo } = request.params;

      const resolved = await resolveOrderRun(orderKey, runNo);
      if (!resolved) {
        return notFound(reply, `Order run not found for order '${orderKey}'`);
      }

      if (resolved.run.status !== OrderRunStatus.released) {
        return conflict(
          reply,
          `Cannot delete order run in ${resolved.run.status} status`,
        );
      }

      await deleteOrderRun(resolved.run.id);
      reply.status(204);
    },
  });
}
