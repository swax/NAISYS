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
  resolveOpRun,
  resolveOrderRun,
} from "../route-helpers.js";
import {
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

function opRunItemActions(
  orderKey: string,
  runNo: number,
  seqNo: number,
  status: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  const href = `${API_PREFIX}/${opRunResource(orderKey, runNo)}/${seqNo}`;
  const actions: HateoasAction[] = [];
  const isExecutor = hasPermission(user, "order_executor");
  const isManager = hasPermission(user, "order_manager");

  if (status === OperationRunStatus.blocked) {
    // Blocked ops can only be skipped by managers
    if (isManager) {
      actions.push({
        rel: "skip",
        href: `${href}/skip`,
        method: "POST",
        title: "Skip",
      });
    }
  } else if (status === OperationRunStatus.pending) {
    if (isExecutor) {
      actions.push(
        {
          rel: "update",
          href,
          method: "PUT",
          title: "Update",
          schema: `${API_PREFIX}/schemas/UpdateOperationRun`,
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
      actions.push({
        rel: "skip",
        href: `${href}/skip`,
        method: "POST",
        title: "Skip",
      });
    }
  } else if (status === OperationRunStatus.in_progress) {
    if (isExecutor) {
      actions.push(
        {
          rel: "update",
          href,
          method: "PUT",
          title: "Update",
          schema: `${API_PREFIX}/schemas/UpdateOperationRun`,
        },
        {
          rel: "complete",
          href: `${href}/complete`,
          method: "POST",
          title: "Complete",
        },
      );
    }
    if (isManager) {
      actions.push({
        rel: "fail",
        href: `${href}/fail`,
        method: "POST",
        title: "Fail",
      });
    }
  } else if (
    status === OperationRunStatus.completed ||
    status === OperationRunStatus.skipped ||
    status === OperationRunStatus.failed
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

const RunNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
});

export const SeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

export function formatOpRun(
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
    completedAt: formatDate(opRun.completedAt),
    feedback: opRun.feedback,
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
    ],
    _actions: opRunItemActions(orderKey, runNo, seqNo, opRun.status, user),
  };
}

function formatListOpRun(
  orderKey: string,
  runNo: number,
  user: ErpUser | undefined,
  opRun: OpRunWithSummary,
) {
  const { _actions, ...rest } = formatOpRun(orderKey, runNo, user, opRun);
  return {
    ...rest,
    stepCount: opRun._count.stepRuns,
    predecessors: opRun.operation.predecessors.map((d) => ({
      seqNo: d.predecessor.seqNo,
      title: d.predecessor.title,
    })),
    _links: [
      selfLink(`/${opRunResource(orderKey, runNo)}/${opRun.operation.seqNo}`),
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
          formatListOpRun(orderKey, runNo, request.erpUser, opRun),
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
