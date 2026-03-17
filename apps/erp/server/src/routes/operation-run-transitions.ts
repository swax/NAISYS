import {
  ErrorResponseSchema,
  OperationRunSchema,
  OperationRunStatus,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { requirePermission } from "../auth-middleware.js";
import { conflict, notFound, unprocessable } from "../error-handler.js";
import { checkOrderRunStarted, resolveOpRun } from "../route-helpers.js";
import {
  clockIn,
  clockOutAllForOpRun,
  isUserClockedIn,
} from "../services/labor-ticket-service.js";
import {
  checkPredecessorsComplete,
  checkStepsComplete,
  reblockSuccessors,
  transitionStatus,
  unblockSuccessors,
  validateStatusFor,
} from "../services/operation-run-service.js";
import { formatOpRun, SeqNoParamsSchema } from "./operation-runs.js";

export default function operationRunTransitionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // START (pending → in_progress)
  app.post("/:seqNo/start", {
    schema: {
      description: "Start an operation run (pending → in_progress)",
      tags: ["Operation Runs"],
      params: SeqNoParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
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

      const statusErr = validateStatusFor("start", resolved.opRun.status, [
        OperationRunStatus.pending,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const priorErr = await checkPredecessorsComplete(
        resolved.run.id,
        resolved.opRun.operationId,
      );
      if (priorErr) return unprocessable(reply, priorErr);

      const opRun = await transitionStatus(
        resolved.opRun.id,
        "start",
        OperationRunStatus.pending,
        OperationRunStatus.in_progress,
        userId,
      );
      await clockIn(resolved.opRun.id, userId, userId);
      return formatOpRun(orderKey, runNo, request.erpUser, opRun);
    },
  });

  // COMPLETE (in_progress → completed)
  app.post("/:seqNo/complete", {
    schema: {
      description: "Complete an operation run (in_progress → completed)",
      tags: ["Operation Runs"],
      params: SeqNoParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
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

      const statusErr = validateStatusFor("complete", resolved.opRun.status, [
        OperationRunStatus.in_progress,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
      if (!clockedIn)
        return conflict(
          reply,
          `You must be clocked in to complete an operation`,
        );

      const stepsErr = await checkStepsComplete(resolved.opRun.id);
      if (stepsErr) return unprocessable(reply, stepsErr);

      const opRun = await transitionStatus(
        resolved.opRun.id,
        "complete",
        OperationRunStatus.in_progress,
        OperationRunStatus.completed,
        userId,
        { completedAt: new Date() },
      );
      await clockOutAllForOpRun(resolved.opRun.id, userId);
      await unblockSuccessors(
        resolved.run.id,
        resolved.opRun.operationId,
        userId,
      );
      return formatOpRun(orderKey, runNo, request.erpUser, opRun);
    },
  });

  // SKIP (pending → skipped)
  app.post("/:seqNo/skip", {
    schema: {
      description: "Skip an operation run (pending → skipped)",
      tags: ["Operation Runs"],
      params: SeqNoParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) return notFound(reply, `Operation run not found`);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const statusErr = validateStatusFor("skip", resolved.opRun.status, [
        OperationRunStatus.blocked,
        OperationRunStatus.pending,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const opRun = await transitionStatus(
        resolved.opRun.id,
        "skip",
        resolved.opRun.status as
          | typeof OperationRunStatus.blocked
          | typeof OperationRunStatus.pending,
        OperationRunStatus.skipped,
        userId,
      );
      await unblockSuccessors(
        resolved.run.id,
        resolved.opRun.operationId,
        userId,
      );
      return formatOpRun(orderKey, runNo, request.erpUser, opRun);
    },
  });

  // FAIL (in_progress → failed)
  app.post("/:seqNo/fail", {
    schema: {
      description: "Fail an operation run (in_progress → failed)",
      tags: ["Operation Runs"],
      params: SeqNoParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) return notFound(reply, `Operation run not found`);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const statusErr = validateStatusFor("fail", resolved.opRun.status, [
        OperationRunStatus.in_progress,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const opRun = await transitionStatus(
        resolved.opRun.id,
        "fail",
        OperationRunStatus.in_progress,
        OperationRunStatus.failed,
        userId,
      );
      return formatOpRun(orderKey, runNo, request.erpUser, opRun);
    },
  });

  // REOPEN (completed/skipped/failed → in_progress/pending)
  app.post("/:seqNo/reopen", {
    schema: {
      description: "Reopen an operation run (completed → in_progress)",
      tags: ["Operation Runs"],
      params: SeqNoParamsSchema,
      response: {
        200: OperationRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) return notFound(reply, `Operation run not found`);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const statusErr = validateStatusFor("reopen", resolved.opRun.status, [
        OperationRunStatus.completed,
        OperationRunStatus.skipped,
        OperationRunStatus.failed,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const reopenTo =
        resolved.opRun.status === OperationRunStatus.skipped
          ? OperationRunStatus.pending
          : OperationRunStatus.in_progress;

      const opRun = await transitionStatus(
        resolved.opRun.id,
        "reopen",
        resolved.opRun.status,
        reopenTo,
        userId,
        { completedAt: null },
      );
      // Re-block successor ops that are still pending
      await reblockSuccessors(
        resolved.run.id,
        resolved.opRun.operationId,
        userId,
      );
      return formatOpRun(orderKey, runNo, request.erpUser, opRun);
    },
  });
}
