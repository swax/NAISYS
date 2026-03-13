import {
  DispatchListQuerySchema,
  OrderRunListResponseSchema,
  OrderRunStatus,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import erpDb from "../erpDb.js";
import { paginationLinks, selfLink } from "../hateoas.js";
import { formatAuditFields, formatDate } from "../route-helpers.js";
import {
  includeRev,
  type OrderRunWithRev,
} from "../services/order-run-service.js";

const OPEN_STATUSES = [OrderRunStatus.released, OrderRunStatus.started];

function formatDispatchRun(orderKey: string, run: OrderRunWithRev) {
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
    _links: [selfLink(`/orders/${orderKey}/runs/${run.runNo}`)],
  };
}

export default function dispatchRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", {
    schema: {
      description: "List open order runs across all orders (dispatch view)",
      tags: ["Dispatch"],
      querystring: DispatchListQuerySchema,
      response: {
        200: OrderRunListResponseSchema,
      },
    },
    handler: async (request) => {
      const { page, pageSize, status, priority, search } = request.query;

      const where: Record<string, unknown> = {
        status: { in: status ? [status] : OPEN_STATUSES },
      };
      if (priority) where.priority = priority;
      if (search) {
        where.OR = [
          { assignedTo: { contains: search } },
          { notes: { contains: search } },
          { order: { key: { contains: search } } },
        ];
      }

      const [items, total] = await Promise.all([
        erpDb.orderRun.findMany({
          where,
          include: {
            ...includeRev,
            order: { select: { key: true, item: { select: { key: true } } } },
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        erpDb.orderRun.count({ where }),
      ]);

      return {
        items: items.map((run) => formatDispatchRun(run.order.key, run)),
        total,
        page,
        pageSize,
        _links: paginationLinks("dispatch", page, pageSize, total, {
          status,
          priority,
          search,
        }),
      };
    },
  });
}
