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

import { writeAuditEntry } from "../audit.js";
import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import type { OperationRunModel } from "../generated/prisma/models/OperationRun.js";
import { API_PREFIX, schemaLink, selfLink } from "../hateoas.js";

function opRunResource(orderKey: string, runId: number) {
  return `orders/${orderKey}/runs/${runId}/ops`;
}

function opRunItemLinks(
  orderKey: string,
  runId: number,
  id: number,
): HateoasLink[] {
  const resource = opRunResource(orderKey, runId);
  return [
    selfLink(`/${resource}/${id}`),
    {
      rel: "collection",
      href: `${API_PREFIX}/${resource}`,
      title: "Operation Runs",
    },
    {
      rel: "run",
      href: `${API_PREFIX}/orders/${orderKey}/runs/${runId}`,
      title: "Order Run",
    },
    schemaLink("OperationRun"),
  ];
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

const IdParamsSchema = z.object({
  orderKey: z.string(),
  runId: z.coerce.number().int(),
  id: z.coerce.number().int(),
});

const includeOp = {
  operation: { select: { seqNo: true, title: true, description: true } },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

type OpRunWithOp = OperationRunModel & {
  operation: { seqNo: number; title: string; description: string };
  createdBy: { username: string };
  updatedBy: { username: string };
};

function formatDate(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function formatItem(
  orderKey: string,
  runId: number,
  user: ErpUser | undefined,
  item: OpRunWithOp,
) {
  return {
    id: item.id,
    orderRunId: item.orderRunId,
    operationId: item.operationId,
    seqNo: item.operation.seqNo,
    title: item.operation.title,
    description: item.operation.description,
    status: item.status,
    completedAt: formatDate(item.completedAt),
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy.username,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedBy.username,
    _links: opRunItemLinks(orderKey, runId, item.id),
    _actions: opRunItemActions(orderKey, runId, item.id, item.status, user),
  };
}

function formatListItem(
  orderKey: string,
  runId: number,
  user: ErpUser | undefined,
  item: OpRunWithOp,
) {
  const { _actions, ...rest } = formatItem(orderKey, runId, user, item);
  return {
    ...rest,
    _links: [selfLink(`/${opRunResource(orderKey, runId)}/${item.id}`)],
  };
}

async function resolveOrderRun(orderKey: string, runId: number) {
  const order = await erpDb.order.findUnique({ where: { key: orderKey } });
  if (!order) return null;

  const run = await erpDb.orderRun.findUnique({ where: { id: runId } });
  if (!run || run.orderId !== order.id) return null;

  return { order, run };
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

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Order run not found`);
      }

      const items = await erpDb.operationRun.findMany({
        where: { orderRunId: runId },
        include: includeOp,
        orderBy: { operation: { seqNo: "asc" } },
      });

      const resource = opRunResource(orderKey, runId);

      return {
        items: items.map((item) =>
          formatListItem(orderKey, runId, request.erpUser, item),
        ),
        total: items.length,
        _links: [selfLink(`/${resource}`)],
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

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Order run not found`);
      }

      const item = await erpDb.operationRun.findUnique({
        where: { id },
        include: includeOp,
      });
      if (!item || item.orderRunId !== runId) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation run ${id} not found`,
        );
      }

      return formatItem(orderKey, runId, request.erpUser, item);
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
      const data = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Order run not found`);
      }

      const existing = await erpDb.operationRun.findUnique({
        where: { id },
      });
      if (!existing || existing.orderRunId !== runId) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation run ${id} not found`,
        );
      }

      if (
        existing.status !== OperationRunStatus.pending &&
        existing.status !== OperationRunStatus.in_progress
      ) {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot update operation run in ${existing.status} status`,
        );
      }

      const updateData: Record<string, unknown> = { updatedById: userId };
      if (data.notes !== undefined) updateData.notes = data.notes;

      const item = await erpDb.operationRun.update({
        where: { id },
        data: updateData,
        include: includeOp,
      });

      return formatItem(orderKey, runId, request.erpUser, item);
    },
  });

  // START (pending → in_progress)
  app.post("/:id/start", {
    schema: {
      description: "Start an operation run (pending → in_progress)",
      tags: ["Operation Runs"],
      params: IdParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, id } = request.params;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Order run not found`);
      }

      const existing = await erpDb.operationRun.findUnique({
        where: { id },
      });
      if (!existing || existing.orderRunId !== runId) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation run ${id} not found`,
        );
      }

      if (existing.status !== OperationRunStatus.pending) {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot start operation run in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.operationRun.update({
          where: { id },
          data: { status: OperationRunStatus.in_progress, updatedById: userId },
          include: includeOp,
        });
        await writeAuditEntry(
          erpTx,
          "OperationRun",
          id,
          "start",
          "status",
          OperationRunStatus.pending,
          OperationRunStatus.in_progress,
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, runId, request.erpUser, item);
    },
  });

  // COMPLETE (in_progress → completed)
  app.post("/:id/complete", {
    schema: {
      description: "Complete an operation run (in_progress → completed)",
      tags: ["Operation Runs"],
      params: IdParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, id } = request.params;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Order run not found`);
      }

      const existing = await erpDb.operationRun.findUnique({
        where: { id },
      });
      if (!existing || existing.orderRunId !== runId) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation run ${id} not found`,
        );
      }

      if (existing.status !== OperationRunStatus.in_progress) {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot complete operation run in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.operationRun.update({
          where: { id },
          data: {
            status: OperationRunStatus.completed,
            completedAt: new Date(),
            updatedById: userId,
          },
          include: includeOp,
        });
        await writeAuditEntry(
          erpTx,
          "OperationRun",
          id,
          "complete",
          "status",
          OperationRunStatus.in_progress,
          OperationRunStatus.completed,
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, runId, request.erpUser, item);
    },
  });

  // SKIP (pending → skipped)
  app.post("/:id/skip", {
    schema: {
      description: "Skip an operation run (pending → skipped)",
      tags: ["Operation Runs"],
      params: IdParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, id } = request.params;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Order run not found`);
      }

      const existing = await erpDb.operationRun.findUnique({
        where: { id },
      });
      if (!existing || existing.orderRunId !== runId) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation run ${id} not found`,
        );
      }

      if (existing.status !== OperationRunStatus.pending) {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot skip operation run in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.operationRun.update({
          where: { id },
          data: { status: OperationRunStatus.skipped, updatedById: userId },
          include: includeOp,
        });
        await writeAuditEntry(
          erpTx,
          "OperationRun",
          id,
          "skip",
          "status",
          OperationRunStatus.pending,
          OperationRunStatus.skipped,
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, runId, request.erpUser, item);
    },
  });

  // FAIL (in_progress → failed)
  app.post("/:id/fail", {
    schema: {
      description: "Fail an operation run (in_progress → failed)",
      tags: ["Operation Runs"],
      params: IdParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, id } = request.params;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Order run not found`);
      }

      const existing = await erpDb.operationRun.findUnique({
        where: { id },
      });
      if (!existing || existing.orderRunId !== runId) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation run ${id} not found`,
        );
      }

      if (existing.status !== OperationRunStatus.in_progress) {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot fail operation run in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.operationRun.update({
          where: { id },
          data: { status: OperationRunStatus.failed, updatedById: userId },
          include: includeOp,
        });
        await writeAuditEntry(
          erpTx,
          "OperationRun",
          id,
          "fail",
          "status",
          OperationRunStatus.in_progress,
          OperationRunStatus.failed,
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, runId, request.erpUser, item);
    },
  });

  // REOPEN (completed → in_progress)
  app.post("/:id/reopen", {
    schema: {
      description: "Reopen an operation run (completed → in_progress)",
      tags: ["Operation Runs"],
      params: IdParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, id } = request.params;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Order run not found`);
      }

      const existing = await erpDb.operationRun.findUnique({
        where: { id },
      });
      if (!existing || existing.orderRunId !== runId) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation run ${id} not found`,
        );
      }

      if (
        existing.status !== OperationRunStatus.completed &&
        existing.status !== OperationRunStatus.skipped &&
        existing.status !== OperationRunStatus.failed
      ) {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot reopen operation run in ${existing.status} status`,
        );
      }

      const reopenTo =
        existing.status === OperationRunStatus.skipped
          ? OperationRunStatus.pending
          : OperationRunStatus.in_progress;

      const userId = request.erpUser!.id;
      const item = await erpDb.$transaction(async (erpTx) => {
        const updated = await erpTx.operationRun.update({
          where: { id },
          data: {
            status: reopenTo,
            completedAt: null,
            updatedById: userId,
          },
          include: includeOp,
        });
        await writeAuditEntry(
          erpTx,
          "OperationRun",
          id,
          "reopen",
          "status",
          existing.status,
          reopenTo,
          userId,
        );
        return updated;
      });

      return formatItem(orderKey, runId, request.erpUser, item);
    },
  });
}
