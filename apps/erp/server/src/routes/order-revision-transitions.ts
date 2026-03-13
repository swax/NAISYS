import {
  ErrorResponseSchema,
  OrderRevisionSchema,
  RevisionStatus,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { conflict, notFound } from "../error-handler.js";
import { resolveOrder } from "../route-helpers.js";
import {
  findExisting,
  transitionStatus,
} from "../services/order-revision-service.js";
import { formatRevision, RevNoParamsSchema } from "./order-revisions.js";

export default function orderRevisionTransitionRoutes(
  fastify: FastifyInstance,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // APPROVE (draft → approved)
  app.post("/:revNo/approve", {
    schema: {
      description: "Approve a draft revision",
      tags: ["Order Revisions"],
      params: RevNoParamsSchema,
      response: {
        200: OrderRevisionSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const existing = await findExisting(order.id, revNo);
      if (!existing) {
        return notFound(
          reply,
          `Revision ${revNo} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot approve revision in ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const revision = await transitionStatus(
        existing.id,
        "approve",
        RevisionStatus.draft,
        RevisionStatus.approved,
        userId,
      );

      return formatRevision(orderKey, request.erpUser, revision);
    },
  });

  // OBSOLETE (approved → obsolete)
  app.post("/:revNo/obsolete", {
    schema: {
      description: "Mark an approved revision as obsolete",
      tags: ["Order Revisions"],
      params: RevNoParamsSchema,
      response: {
        200: OrderRevisionSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;

      const order = await resolveOrder(orderKey);
      if (!order) {
        return notFound(reply, `Order '${orderKey}' not found`);
      }

      const existing = await findExisting(order.id, revNo);
      if (!existing) {
        return notFound(
          reply,
          `Revision ${revNo} not found for order '${orderKey}'`,
        );
      }

      if (existing.status !== RevisionStatus.approved) {
        return conflict(
          reply,
          `Cannot mark revision as obsolete from ${existing.status} status`,
        );
      }

      const userId = request.erpUser!.id;
      const revision = await transitionStatus(
        existing.id,
        "obsolete",
        RevisionStatus.approved,
        RevisionStatus.obsolete,
        userId,
      );

      return formatRevision(orderKey, request.erpUser, revision);
    },
  });
}
