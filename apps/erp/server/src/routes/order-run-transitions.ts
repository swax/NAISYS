import {
  ErrorResponseSchema,
  OrderRunSchema,
  OrderRunStatus,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { requirePermission } from "../auth-middleware.js";
import { conflict, notFound, unprocessable } from "../error-handler.js";
import { resolveOrderRun } from "../route-helpers.js";
import {
  checkOpsComplete,
  getReopenTarget,
  transitionStatus,
  validateStatusFor,
} from "../services/order-run-service.js";
import { formatRun, RunNoParamsSchema } from "./order-runs.js";

export default function orderRunTransitionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // START (released -> started)
  app.post("/:runNo/start", {
    schema: {
      description: "Start an order run (released -> started)",
      tags: ["Order Runs"],
      params: RunNoParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo } = request.params;

      const resolved = await resolveOrderRun(orderKey, runNo);
      if (!resolved) {
        return notFound(reply, `Order run not found for order '${orderKey}'`);
      }

      const statusErr = validateStatusFor("start", resolved.run.status, [
        OrderRunStatus.released,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const userId = request.erpUser!.id;
      const run = await transitionStatus(
        resolved.run.id,
        "start",
        OrderRunStatus.released,
        OrderRunStatus.started,
        userId,
      );

      return formatRun(orderKey, request.erpUser, run);
    },
  });

  // CLOSE (started -> closed)
  app.post("/:runNo/close", {
    schema: {
      description: "Close an order run (started -> closed)",
      tags: ["Order Runs"],
      params: RunNoParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo } = request.params;

      const resolved = await resolveOrderRun(orderKey, runNo);
      if (!resolved) {
        return notFound(reply, `Order run not found for order '${orderKey}'`);
      }

      const statusErr = validateStatusFor("close", resolved.run.status, [
        OrderRunStatus.started,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      // Validate all operation runs are completed or skipped
      const opsErr = await checkOpsComplete(resolved.run.id);
      if (opsErr) return unprocessable(reply, opsErr);

      const userId = request.erpUser!.id;
      const run = await transitionStatus(
        resolved.run.id,
        "close",
        OrderRunStatus.started,
        OrderRunStatus.closed,
        userId,
      );

      return formatRun(orderKey, request.erpUser, run);
    },
  });

  // CANCEL (released/started -> cancelled)
  app.post("/:runNo/cancel", {
    schema: {
      description: "Cancel an order run (released/started -> cancelled)",
      tags: ["Order Runs"],
      params: RunNoParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey, runNo } = request.params;

      const resolved = await resolveOrderRun(orderKey, runNo);
      if (!resolved) {
        return notFound(reply, `Order run not found for order '${orderKey}'`);
      }

      const statusErr = validateStatusFor("cancel", resolved.run.status, [
        OrderRunStatus.released,
        OrderRunStatus.started,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const userId = request.erpUser!.id;
      const run = await transitionStatus(
        resolved.run.id,
        "cancel",
        resolved.run.status as
          | typeof OrderRunStatus.released
          | typeof OrderRunStatus.started,
        OrderRunStatus.cancelled,
        userId,
      );

      return formatRun(orderKey, request.erpUser, run);
    },
  });

  // REOPEN (closed -> started, cancelled -> released)
  app.post("/:runNo/reopen", {
    schema: {
      description:
        "Reopen an order run (closed -> started, cancelled -> released)",
      tags: ["Order Runs"],
      params: RunNoParamsSchema,
      response: {
        200: OrderRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_manager"),
    handler: async (request, reply) => {
      const { orderKey, runNo } = request.params;

      const resolved = await resolveOrderRun(orderKey, runNo);
      if (!resolved) {
        return notFound(reply, `Order run not found for order '${orderKey}'`);
      }

      const statusErr = validateStatusFor("reopen", resolved.run.status, [
        OrderRunStatus.closed,
        OrderRunStatus.cancelled,
      ]);
      if (statusErr) return conflict(reply, statusErr);

      const reopenTo = getReopenTarget(
        resolved.run.status as
          | typeof OrderRunStatus.closed
          | typeof OrderRunStatus.cancelled,
      );

      const userId = request.erpUser!.id;
      const run = await transitionStatus(
        resolved.run.id,
        "reopen",
        resolved.run.status as
          | typeof OrderRunStatus.closed
          | typeof OrderRunStatus.cancelled,
        reopenTo,
        userId,
      );

      return formatRun(orderKey, request.erpUser, run);
    },
  });
}
