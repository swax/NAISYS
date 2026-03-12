import {
  ErrorResponseSchema,
  OperationRunSchema,
  OperationRunStatus,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { conflict, notFound, unprocessable } from "../error-handler.js";
import { checkOrderRunStarted, resolveOrderRun } from "../route-helpers.js";
import {
  checkPriorOpsComplete,
  checkStepsComplete,
  findExisting,
  transitionStatus,
  validateStatusFor,
} from "../services/operation-run-service.js";
import { formatItem, IdParamsSchema } from "./operation-runs.js";

export default function operationRunTransitionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

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
        422: ErrorResponseSchema,
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

      const statusErr = validateStatusFor("start", existing.status, [
        OperationRunStatus.pending,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const priorErr = await checkPriorOpsComplete(
        runId,
        existing.operation.seqNo,
      );
      if (priorErr) return unprocessable(reply, priorErr);

      const item = await transitionStatus(
        id,
        "start",
        OperationRunStatus.pending,
        OperationRunStatus.in_progress,
        userId,
      );
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
        422: ErrorResponseSchema,
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

      const statusErr = validateStatusFor("complete", existing.status, [
        OperationRunStatus.in_progress,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const stepsErr = await checkStepsComplete(id);
      if (stepsErr) return unprocessable(reply, stepsErr);

      const item = await transitionStatus(
        id,
        "complete",
        OperationRunStatus.in_progress,
        OperationRunStatus.completed,
        userId,
        { completedAt: new Date() },
      );
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
      const userId = request.erpUser!.id;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) return notFound(reply, `Order run not found`);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const existing = await findExisting(id, runId);
      if (!existing) return notFound(reply, `Operation run ${id} not found`);

      const statusErr = validateStatusFor("skip", existing.status, [
        OperationRunStatus.pending,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const item = await transitionStatus(
        id,
        "skip",
        OperationRunStatus.pending,
        OperationRunStatus.skipped,
        userId,
      );
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
      const userId = request.erpUser!.id;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) return notFound(reply, `Order run not found`);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const existing = await findExisting(id, runId);
      if (!existing) return notFound(reply, `Operation run ${id} not found`);

      const statusErr = validateStatusFor("fail", existing.status, [
        OperationRunStatus.in_progress,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const item = await transitionStatus(
        id,
        "fail",
        OperationRunStatus.in_progress,
        OperationRunStatus.failed,
        userId,
      );
      return formatItem(orderKey, runId, request.erpUser, item);
    },
  });

  // REOPEN (completed/skipped/failed → in_progress/pending)
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
      const userId = request.erpUser!.id;

      const resolved = await resolveOrderRun(orderKey, runId);
      if (!resolved) return notFound(reply, `Order run not found`);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const existing = await findExisting(id, runId);
      if (!existing) return notFound(reply, `Operation run ${id} not found`);

      const statusErr = validateStatusFor("reopen", existing.status, [
        OperationRunStatus.completed,
        OperationRunStatus.skipped,
        OperationRunStatus.failed,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const reopenTo =
        existing.status === OperationRunStatus.skipped
          ? OperationRunStatus.pending
          : OperationRunStatus.in_progress;

      const item = await transitionStatus(
        id,
        "reopen",
        existing.status,
        reopenTo,
        userId,
        { completedAt: null },
      );
      return formatItem(orderKey, runId, request.erpUser, item);
    },
  });
}
