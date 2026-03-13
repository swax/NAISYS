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
import { includeRev, type OrderRunWithRev } from "../services/order-run-service.js";

const OPEN_STATUSES = [OrderRunStatus.released, OrderRunStatus.started];

function formatDispatchItem(
  orderKey: string,
  item: OrderRunWithRev,
) {
  return {
    id: item.id,
    runNo: item.runNo,
    orderId: item.orderId,
    orderKey,
    revNo: item.orderRev.revNo,
    itemKey: item.order?.item?.key ?? null,
    status: item.status,
    priority: item.priority,
    scheduledStartAt: formatDate(item.scheduledStartAt),
    dueAt: formatDate(item.dueAt),
    assignedTo: item.assignedTo,
    notes: item.notes,
    ...formatAuditFields(item),
    _links: [selfLink(`/orders/${orderKey}/runs/${item.id}`)],
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
        items: items.map((item) =>
          formatDispatchItem(item.order.key, item),
        ),
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
