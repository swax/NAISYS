import {
  DispatchListQuerySchema,
  DispatchListResponseSchema,
  type ErpPermission,
  OperationRunStatus,
  OrderRunStatus,
} from "@naisys/erp-shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import erpDb from "../erpDb.js";
import { API_PREFIX, paginationLinks } from "../hateoas.js";
import { getUserWorkCenterIds } from "../services/work-center-service.js";

const OPEN_ORDER_STATUSES = [OrderRunStatus.released, OrderRunStatus.started];
const DEFAULT_OP_STATUSES = [
  OperationRunStatus.pending,
  OperationRunStatus.in_progress,
  OperationRunStatus.failed,
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
      const {
        page,
        pageSize,
        status,
        priority,
        search,
        viewAs,
        canWork,
        clockedIn,
      } = request.query;

      // Resolve the perspective user for canWork computation
      let perspectiveUserId = request.erpUser?.id;
      let perspectivePerms: Set<ErpPermission> = new Set(
        request.erpUser?.permissions ?? [],
      );
      if (viewAs) {
        const viewAsUser = await erpDb.user.findUnique({
          where: { username: viewAs },
          select: {
            id: true,
            permissions: { select: { permission: true } },
          },
        });
        if (viewAsUser) {
          perspectiveUserId = viewAsUser.id;
          perspectivePerms = new Set(
            viewAsUser.permissions.map((p) => p.permission),
          );
        }
      }

      const isExecutor = perspectivePerms.has("order_executor");
      const isManager = perspectivePerms.has("order_manager");

      // Pre-fetch perspective user's work center IDs for canWork computation + filtering
      const userWcIds = perspectiveUserId
        ? await getUserWorkCenterIds(perspectiveUserId)
        : [];
      const userWcIdSet = new Set(userWcIds);

      const where: Record<string, unknown> = {
        status: { in: status ? [status] : DEFAULT_OP_STATUSES },
        orderRun: {
          status: { in: OPEN_ORDER_STATUSES },
          ...(priority ? { priority } : {}),
        },
      };

      // canWork filter: only show ops where the perspective user can work
      if (canWork) {
        // Restrict to statuses the user has permission for
        const workableStatuses: string[] = [];
        if (isExecutor) {
          workableStatuses.push(
            OperationRunStatus.pending,
            OperationRunStatus.in_progress,
          );
        }
        if (isManager) {
          workableStatuses.push(OperationRunStatus.failed);
        }

        // Intersect with the requested status filter
        const currentStatuses = status ? [status] : DEFAULT_OP_STATUSES;
        const filteredStatuses = currentStatuses.filter((s) =>
          workableStatuses.includes(s),
        );
        where.status = { in: filteredStatuses };

        // Work center access
        if (userWcIds.length > 0) {
          where.operation = {
            OR: [{ workCenterId: null }, { workCenterId: { in: userWcIds } }],
          };
        }
      }

      if (search) {
        where.OR = [
          { operation: { title: { contains: search } } },
          { assignedTo: { username: { contains: search } } },
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
            operation: {
              select: {
                seqNo: true,
                title: true,
                workCenter: { select: { key: true, id: true } },
              },
            },
            assignedTo: { select: { username: true } },
            orderRun: {
              select: {
                runNo: true,
                priority: true,
                dueAt: true,
                order: { select: { key: true } },
                orderRev: { select: { revNo: true } },
              },
            },
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { orderRun: { dueAt: "asc" } },
        }),
        erpDb.operationRun.count({ where }),
      ]);

      return {
        items: items.map((opRun) => {
          const wcId = opRun.operation.workCenter?.id ?? null;
          const hasWcAccess = wcId === null || userWcIdSet.has(wcId);

          // canWork: work center access + permission for the op status
          const hasStatusPerm =
            opRun.status === OperationRunStatus.failed ? isManager : isExecutor;
          const itemCanWork = hasWcAccess && hasStatusPerm;

          return {
            id: opRun.id,
            orderKey: opRun.orderRun.order.key,
            revNo: opRun.orderRun.orderRev.revNo,
            runNo: opRun.orderRun.runNo,
            seqNo: opRun.operation.seqNo,
            title: opRun.operation.title,
            workCenterKey: opRun.operation.workCenter?.key ?? null,
            canWork: itemCanWork,
            status: opRun.status,
            priority: opRun.orderRun.priority,
            assignedTo: opRun.assignedTo?.username ?? null,
            dueAt: opRun.orderRun.dueAt,
            createdAt: opRun.createdAt.toISOString(),
          };
        }),
        total,
        page,
        pageSize,
        _links: [
          ...paginationLinks("dispatch", page, pageSize, total, {
            status,
            priority,
            search,
            viewAs,
            canWork: canWork ? "true" : undefined,
            clockedIn: clockedIn ? "true" : undefined,
          }),
          {
            rel: "work-centers",
            href: `${API_PREFIX}/work-centers`,
            title: "Work Centers",
          },
        ],
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}/orders/{orderKey}/runs/{runNo}/ops/{seqNo}`,
          },
        ],
        _actionTemplates: [
          {
            rel: "viewOperationRun",
            hrefTemplate: `${API_PREFIX}/orders/{orderKey}/runs/{runNo}/ops/{seqNo}`,
            method: "GET",
            title: "View Operation Run",
          },
        ],
      };
    },
  });
}
