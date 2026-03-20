import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  ErrorResponseSchema,
  OperationRunListResponseSchema,
  OperationRunSchema,
  OperationRunStatus,
  UpdateOperationRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  checkOrderRunStarted,
  childItemLinks,
  formatAuditFields,
  formatDate,
  resolveActions,
  resolveOpRun,
  resolveOrderRun,
} from "../route-helpers.js";
import {
  checkStepsComplete,
  getOpRun,
  listOpRuns,
  type OpRunWithOp,
  type OpRunWithSummary,
  updateOpRun,
  validateStatusFor,
} from "../services/operation-run-service.js";

function opRunResource(orderKey: string, runNo: number) {
  return `orders/${orderKey}/runs/${runNo}/ops`;
}

async function opRunItemActions(
  orderKey: string, runNo: number, seqNo: number,
  opRunId: number, status: string, user: ErpUser | undefined,
): Promise<HateoasAction[]> {
  const href = `${API_PREFIX}/${opRunResource(orderKey, runNo)}/${seqNo}`;
  const isExecutor = hasPermission(user, "order_executor");
  const stepsErr = isExecutor && status === OperationRunStatus.in_progress
    ? await checkStepsComplete(opRunId) : null;

  return resolveActions([
    {
      rel: "assign",
      method: "PUT",
      title: "Assign",
      schema: `${API_PREFIX}/schemas/UpdateOperationRun`,
      permission: "order_manager",
      statuses: [OperationRunStatus.blocked, OperationRunStatus.pending, OperationRunStatus.in_progress],
    },
    {
      rel: "add-comment",
      path: "/comments",
      method: "POST",
      title: "Add Comment",
      schema: `${API_PREFIX}/schemas/CreateOperationRunComment`,
      permission: "order_executor",
    },
    {
      rel: "start",
      path: "/start",
      method: "POST",
      title: "Start",
      permission: "order_executor",
      statuses: [OperationRunStatus.blocked, OperationRunStatus.pending],
      disabledWhen: (ctx) =>
        ctx.status === OperationRunStatus.blocked
          ? "Operation is blocked by incomplete predecessors"
          : null,
    },
    {
      rel: "update",
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateOperationRun`,
      permission: "order_executor",
      statuses: [OperationRunStatus.pending, OperationRunStatus.in_progress],
    },
    {
      rel: "complete",
      path: "/complete",
      method: "POST",
      title: "Complete",
      permission: "order_executor",
      statuses: [OperationRunStatus.in_progress],
      disabledWhen: () => stepsErr,
    },
    {
      rel: "skip",
      path: "/skip",
      method: "POST",
      title: "Skip",
      permission: "order_manager",
      statuses: [OperationRunStatus.blocked, OperationRunStatus.pending],
    },
    {
      rel: "fail",
      path: "/fail",
      method: "POST",
      title: "Fail",
      permission: "order_manager",
      statuses: [OperationRunStatus.in_progress],
    },
    {
      rel: "reopen",
      path: "/reopen",
      method: "POST",
      title: "Reopen",
      permission: "order_manager",
      statuses: [OperationRunStatus.completed, OperationRunStatus.skipped, OperationRunStatus.failed],
    },
  ], href, { status, user });
}

const RunNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
});

export const SeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

export async function formatOpRun(
  orderKey: string,
  runNo: number,
  user: ErpUser | undefined,
  opRun: OpRunWithOp,
) {
  const seqNo = opRun.operation.seqNo;
  return {
    id: opRun.id,
    orderRunId: opRun.orderRunId,
    operationId: opRun.operationId,
    seqNo,
    title: opRun.operation.title,
    description: opRun.operation.description,
    status: opRun.status,
    assignedTo: opRun.assignedTo?.username ?? null,
    cost: opRun.cost,
    completedAt: formatDate(opRun.completedAt),
    ...formatAuditFields(opRun),
    _links: [
      ...childItemLinks(
        "/" + opRunResource(orderKey, runNo),
        seqNo,
        "Operation Runs",
        "/orders/" + orderKey + "/runs/" + runNo,
        "Order Run",
        "OperationRun",
        "run",
      ),
      {
        rel: "steps",
        href: `${API_PREFIX}/${opRunResource(orderKey, runNo)}/${seqNo}/steps`,
        title: "Step Runs",
      } as HateoasLink,
      {
        rel: "labor",
        href: `${API_PREFIX}/${opRunResource(orderKey, runNo)}/${seqNo}/labor`,
        title: "Labor Tickets",
      } as HateoasLink,
      {
        rel: "comments",
        href: `${API_PREFIX}/${opRunResource(orderKey, runNo)}/${seqNo}/comments`,
        title: "Comments",
      } as HateoasLink,
    ],
    _actions: await opRunItemActions(orderKey, runNo, seqNo, opRun.id, opRun.status, user),
  };
}

function formatListOpRun(
  orderKey: string,
  runNo: number,
  opRun: OpRunWithSummary,
) {
  const seqNo = opRun.operation.seqNo;
  return {
    id: opRun.id,
    orderRunId: opRun.orderRunId,
    operationId: opRun.operationId,
    seqNo,
    title: opRun.operation.title,
    description: opRun.operation.description,
    status: opRun.status,
    assignedTo: opRun.assignedTo?.username ?? null,
    cost: opRun.cost,
    completedAt: formatDate(opRun.completedAt),
    ...formatAuditFields(opRun),
    stepCount: opRun._count.stepRuns,
    predecessors: opRun.operation.predecessors.map((d) => ({
      seqNo: d.predecessor.seqNo,
      title: d.predecessor.title,
    })),
    _links: [
      selfLink(`/${opRunResource(orderKey, runNo)}/${seqNo}`),
    ],
  };
}

export default function operationRunRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List operation runs for an order run",
      tags: ["Operation Runs"],
      params: RunNoParamsSchema,
      response: {
        200: OperationRunListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runNo } = request.params;

      const resolved = await resolveOrderRun(orderKey, runNo);
      if (!resolved) {
        return notFound(reply, `Order run not found`);
      }

      const items = await listOpRuns(resolved.run.id);

      return {
        items: items.map((opRun) =>
          formatListOpRun(orderKey, runNo, opRun),
        ),
        total: items.length,
        _links: [selfLink(`/${opRunResource(orderKey, runNo)}`)],
      };
    },
  });

  // GET by seqNo
  app.get("/:seqNo", {
    schema: {
      description: "Get a single operation run by operation sequence number",
      tags: ["Operation Runs"],
      params: SeqNoParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) {
        return notFound(reply, `Operation run not found`);
      }

      const opRun = await getOpRun(resolved.opRun.id);
      if (!opRun) {
        return notFound(reply, `Operation run not found`);
      }

      return formatOpRun(orderKey, runNo, request.erpUser, opRun);
    },
  });

  // UPDATE (pending/in_progress only)
  app.put("/:seqNo", {
    schema: {
      description:
        "Update an operation run (pending or in_progress status only)",
      tags: ["Operation Runs"],
      params: SeqNoParamsSchema,
      body: UpdateOperationRunSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) return notFound(reply, `Operation run not found`);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const statusErr = validateStatusFor("update", resolved.opRun.status, [
        OperationRunStatus.pending,
        OperationRunStatus.in_progress,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const opRun = await updateOpRun(resolved.opRun.id, request.body, userId);
      return formatOpRun(orderKey, runNo, request.erpUser, opRun);
    },
  });
}
