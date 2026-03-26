import {
  ErrorResponseSchema,
  StepRunTransitionSlimSchema,
  TransitionNoteSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { requirePermission } from "../auth-middleware.js";
import { conflict, notFound, unprocessable } from "../error-handler.js";
import {
  checkOpRunInProgress,
  checkOrderRunStarted,
  checkWorkCenterAccess,
  mutationResult,
  resolveStepRun,
} from "../route-helpers.js";
import { validateCompletionFields } from "../services/field-value-service.js";
import { isUserClockedIn } from "../services/labor-ticket-service.js";
import {
  getStepRunWithFields,
  updateStepRun,
} from "../services/step-run-service.js";
import { formatStepRunTransition } from "./step-runs.js";

const StepSeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
});

export default function stepRunTransitionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // COMPLETE (not completed → completed)
  app.post("/:stepSeqNo/complete", {
    schema: {
      description: "Complete a step run (operation run must be in_progress)",
      tags: ["Step Runs"],
      params: StepSeqNoParamsSchema,
      body: TransitionNoteSchema,
      response: {
        200: StepRunTransitionSlimSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo, stepSeqNo } = request.params;
      const { note } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
      if (!resolved) return notFound(reply, `Step run not found`);

      const wcErr = await checkWorkCenterAccess(
        resolved.opRun.operationId,
        request.erpUser!,
      );
      if (wcErr) return conflict(reply, wcErr);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      if (resolved.stepRun.completed) {
        return conflict(reply, "Step is already completed");
      }

      const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
      if (!clockedIn) {
        return conflict(reply, "You must be clocked in to complete steps");
      }

      // Validate all stored field values
      const existing = await getStepRunWithFields(resolved.stepRun.id);
      if (!existing) return notFound(reply, `Step run not found`);

      const completionErr = validateCompletionFields(existing);
      if (completionErr) return unprocessable(reply, completionErr);

      const stepRun = await updateStepRun(
        resolved.stepRun.id,
        true,
        note,
        userId,
      );

      const full = await formatStepRunTransition(
        orderKey,
        runNo,
        seqNo,
        resolved.opRun.id,
        resolved.opRun.operationId,
        resolved.opRun.status,
        request.erpUser,
        stepRun,
      );
      return mutationResult(request, reply, full, {
        completed: stepRun.completed,
        _actions: full._actions,
      });
    },
  });

  // REOPEN (completed → not completed)
  app.post("/:stepSeqNo/reopen", {
    schema: {
      description: "Reopen a completed step run",
      tags: ["Step Runs"],
      params: StepSeqNoParamsSchema,
      body: TransitionNoteSchema,
      response: {
        200: StepRunTransitionSlimSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo, stepSeqNo } = request.params;
      const { note } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
      if (!resolved) return notFound(reply, `Step run not found`);

      const wcErr = await checkWorkCenterAccess(
        resolved.opRun.operationId,
        request.erpUser!,
      );
      if (wcErr) return conflict(reply, wcErr);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      if (!resolved.stepRun.completed) {
        return conflict(reply, "Step is not completed");
      }

      const stepRun = await updateStepRun(
        resolved.stepRun.id,
        false,
        note,
        userId,
      );

      const full = await formatStepRunTransition(
        orderKey,
        runNo,
        seqNo,
        resolved.opRun.id,
        resolved.opRun.operationId,
        resolved.opRun.status,
        request.erpUser,
        stepRun,
      );
      return mutationResult(request, reply, full, {
        completed: stepRun.completed,
        _actions: full._actions,
      });
    },
  });
}
