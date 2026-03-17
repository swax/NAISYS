import {
  DispatchListQuerySchema,
  DispatchListResponseSchema,
  OperationRunStatus,
  OrderRunStatus,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import erpDb from "../erpDb.js";
import { paginationLinks } from "../hateoas.js";
import { formatDate } from "../route-helpers.js";

const OPEN_ORDER_STATUSES = [OrderRunStatus.released, OrderRunStatus.started];
const DEFAULT_OP_STATUSES = [
  OperationRunStatus.pending,
  OperationRunStatus.in_progress,
];

export default function dispatchRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", {
    schema: {
      description: "List operation runs across open orders (dispatch view)",
      tags: ["Dispatch"],
      querystring: DispatchListQuerySchema,
      response: {
        200: DispatchListResponseSchema,
      },
    },
    handler: async (request) => {
      const { page, pageSize, status, priority, search, clockedIn } =
        request.query;

      const where: Record<string, unknown> = {
        status: { in: status ? [status] : DEFAULT_OP_STATUSES },
        orderRun: {
          status: { in: OPEN_ORDER_STATUSES },
          ...(priority ? { priority } : {}),
        },
      };

      if (search) {
        where.OR = [
          { operation: { title: { contains: search } } },
          { orderRun: { assignedTo: { contains: search } } },
          { orderRun: { order: { key: { contains: search } } } },
        ];
      }

      if (clockedIn) {
        where.laborTickets = { some: { clockOut: null } };
      }

      const [items, total] = await Promise.all([
        erpDb.operationRun.findMany({
          where,
          include: {
            operation: { select: { seqNo: true, title: true } },
            orderRun: {
              select: {
                runNo: true,
                priority: true,
                assignedTo: true,
                dueAt: true,
                order: { select: { key: true } },
                orderRev: { select: { revNo: true } },
              },
            },
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        erpDb.operationRun.count({ where }),
      ]);

      return {
        items: items.map((opRun) => ({
          id: opRun.id,
          orderKey: opRun.orderRun.order.key,
          revNo: opRun.orderRun.orderRev.revNo,
          runNo: opRun.orderRun.runNo,
          seqNo: opRun.operation.seqNo,
          title: opRun.operation.title,
          status: opRun.status,
          priority: opRun.orderRun.priority,
          assignedTo: opRun.orderRun.assignedTo,
          dueAt: formatDate(opRun.orderRun.dueAt),
          createdAt: opRun.createdAt.toISOString(),
          _links: [],
        })),
        total,
        page,
        pageSize,
        _links: paginationLinks("dispatch", page, pageSize, total, {
          status,
          priority,
          search,
          clockedIn: clockedIn ? "true" : undefined,
        }),
      };
    },
  });
}
