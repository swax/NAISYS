import type { HateoasAction } from "@naisys/common";
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
import { hasPermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  checkOrderRunStarted,
  childItemLinks,
  formatAuditFields,
  formatDate,
  resolveOrderRun,
} from "../route-helpers.js";
import {
  findExisting,
  getOpRun,
  listOpRuns,
  type OpRunWithOp,
  updateOpRun,
  validateStatusFor,
} from "../services/operation-run-service.js";

function opRunResource(orderKey: string, runId: number) {
  return `orders/${orderKey}/runs/${runId}/ops`;
}

function opRunItemActions(
  orderKey: string,
  runId: number,
  id: number,
  status: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "manage_runs")) return [];
  const href = `${API_PREFIX}/${opRunResource(orderKey, runId)}/${id}`;
  const actions: HateoasAction[] = [];

  if (status === OperationRunStatus.pending) {
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
      {
        rel: "skip",
        href: `${href}/skip`,
        method: "POST",
        title: "Skip",
      },
    );
  } else if (status === OperationRunStatus.in_progress) {
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
      {
        rel: "fail",
        href: `${href}/fail`,
        method: "POST",
        title: "Fail",
      },
    );
  } else if (
    status === OperationRunStatus.completed ||
    status === OperationRunStatus.skipped ||
    status === OperationRunStatus.failed
  ) {
    actions.push({
      rel: "reopen",
      href: `${href}/reopen`,
      method: "POST",
      title: "Reopen",
    });
  }

  return actions;
}

const RunParamsSchema = z.object({
  orderKey: z.string(),
  runId: z.coerce.number().int(),
});

export const IdParamsSchema = z.object({
  orderKey: z.string(),
  runId: z.coerce.number().int(),
  id: z.coerce.number().int(),
});

export function formatOpRun(
  orderKey: string,
  runId: number,
  user: ErpUser | undefined,
  opRun: OpRunWithOp,
) {
  return {
    id: opRun.id,
    orderRunId: opRun.orderRunId,
    operationId: opRun.operationId,
    seqNo: opRun.operation.seqNo,
    title: opRun.operation.title,
    description: opRun.operation.description,
    status: opRun.status,
    completedAt: formatDate(opRun.completedAt),
    feedback: opRun.feedback,
    ...formatAuditFields(opRun),
    _links: childItemLinks(
      "/" + opRunResource(orderKey, runId),
      opRun.id,
      "Operation Runs",
      "/orders/" + orderKey + "/runs/" + runId,
      "Order Run",
      "OperationRun",
      "run",
    ),
    _actions: opRunItemActions(orderKey, runId, opRun.id, opRun.status, user),
  };
}

function formatListOpRun(
  orderKey: string,
  runId: number,
  user: ErpUser | undefined,
  opRun: OpRunWithOp,
) {
  const { _actions, ...rest } = formatOpRun(orderKey, runId, user, opRun);
  return {
    ...rest,
    _links: [selfLink(`/${opRunResource(orderKey, runId)}/${opRun.id}`)],
  };
}

export default function operationRunRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List operation runs for an order run",
      tags: ["Operation Runs"],
      params: RunParamsSchema,
      response: {
        200: OperationRunListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId } = request.params;

      if (!(await resolveOrderRun(orderKey, runId))) {
        return notFound(reply, `Order run not found`);
      }

      const items = await listOpRuns(runId);

      return {
        items: items.map((opRun) =>
          formatListOpRun(orderKey, runId, request.erpUser, opRun),
        ),
        total: items.length,
        _links: [selfLink(`/${opRunResource(orderKey, runId)}`)],
      };
    },
  });

  // GET by ID
  app.get("/:id", {
    schema: {
      description: "Get a single operation run by ID",
      tags: ["Operation Runs"],
      params: IdParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, id } = request.params;

      if (!(await resolveOrderRun(orderKey, runId))) {
        return notFound(reply, `Order run not found`);
      }

      const opRun = await getOpRun(id);
      if (!opRun || opRun.orderRunId !== runId) {
        return notFound(reply, `Operation run ${id} not found`);
      }

      return formatOpRun(orderKey, runId, request.erpUser, opRun);
    },
  });

  // UPDATE (pending/in_progress only)
  app.put("/:id", {
    schema: {
      description:
        "Update an operation run (pending or in_progress status only)",
      tags: ["Operation Runs"],
      params: IdParamsSchema,
      body: UpdateOperationRunSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, id } = request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) return notFound(reply, `Order run not found`);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const existing = await findExisting(id, runId);
      if (!existing) return notFound(reply, `Operation run ${id} not found`);

      const statusErr = validateStatusFor("update", existing.status, [
        OperationRunStatus.pending,
        OperationRunStatus.in_progress,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const opRun = await updateOpRun(id, request.body, userId);
      return formatOpRun(orderKey, runId, request.erpUser, opRun);
    },
  });
}
