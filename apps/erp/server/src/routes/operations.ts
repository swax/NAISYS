import type { HateoasLink } from "@naisys/common";
import {
  CreateOperationSchema,
  ErrorResponseSchema,
  OperationListResponseSchema,
  OperationSchema,
  RevisionStatus,
  UpdateOperationSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import type { OperationModel } from "../generated/prisma/models/Operation.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  calcNextSeqNo,
  childItemLinks,
  draftCrudActions,
  formatAuditFields,
  permGate,
  resolveRevision,
  type WithAuditUsers,
} from "../route-helpers.js";
import {
  createOperation,
  deleteOperation,
  findExisting,
  getOperation,
  listOperations,
  updateOperation,
} from "../services/operation-service.js";

const ParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
});

const OpParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

function opBasePath(orderKey: string, revNo: number) {
  return `/orders/${orderKey}/revs/${revNo}/ops`;
}

function formatOperation(
  orderKey: string,
  revNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  operation: OperationModel & WithAuditUsers,
  summary?: {
    stepCount: number;
    predecessors: Array<{ seqNo: number; title: string }>;
  },
) {
  const base = opBasePath(orderKey, revNo);
  return {
    id: operation.id,
    orderRevId: operation.orderRevId,
    seqNo: operation.seqNo,
    title: operation.title,
    description: operation.description,
    ...(summary
      ? {
          stepCount: summary.stepCount,
          predecessors: summary.predecessors,
        }
      : {}),
    ...formatAuditFields(operation),
    _links: [
      ...childItemLinks(
        base,
        operation.seqNo,
        "Operations",
        `/orders/${orderKey}/revs/${revNo}`,
        "Revision",
        "Operation",
      ),
      {
        rel: "steps",
        href: `${API_PREFIX}${base}/${operation.seqNo}/steps`,
        title: "Steps",
      } as HateoasLink,
    ],
    _actions: draftCrudActions(
      `${API_PREFIX}${base}/${operation.seqNo}`,
      "UpdateOperation",
      revStatus,
      user,
    ),
  };
}

export default function operationRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List operations for a revision",
      tags: ["Operations"],
      params: ParamsSchema,
      response: {
        200: OperationListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;

      const resolved = await resolveRevision(orderKey, revNo);
      if (!resolved) {
        return notFound(reply, `Revision not found`);
      }

      const items = await listOperations(resolved.rev.id);

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;

      const user = request.erpUser;
      const base = opBasePath(orderKey, revNo);
      return {
        items: items.map((operation) =>
          formatOperation(
            orderKey,
            revNo,
            resolved.rev.status,
            user,
            operation,
            {
              stepCount: operation._count.steps,
              predecessors: operation.predecessors.map((d) => ({
                seqNo: d.predecessor.seqNo,
                title: d.predecessor.title,
              })),
            },
          ),
        ),
        total: items.length,
        nextSeqNo: calcNextSeqNo(maxSeq),
        _links: [selfLink(base)],
        _actions: [{
          rel: "create",
          href: `${API_PREFIX}${base}`,
          method: "POST" as const,
          title: "Add Operation",
          schema: `${API_PREFIX}/schemas/CreateOperation`,
          ...(!hasPermission(user, "order_planner")
            ? permGate(false, "order_planner")
            : resolved.rev.status !== RevisionStatus.draft
              ? { disabled: true, disabledReason: "Can only add operations in draft revisions" }
              : {}),
        }],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create an operation for a revision",
      tags: ["Operations"],
      params: ParamsSchema,
      body: CreateOperationSchema,
      response: {
        201: OperationSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo } = request.params;
      const { seqNo: requestedSeqNo, title, description } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveRevision(orderKey, revNo);
      if (!resolved) {
        return notFound(reply, `Revision not found`);
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot add operations to a ${resolved.rev.status} revision`,
        );
      }

      const operation = await createOperation(
        resolved.rev.id,
        requestedSeqNo,
        title,
        description,
        userId,
      );

      reply.status(201);
      return formatOperation(
        orderKey,
        revNo,
        resolved.rev.status,
        request.erpUser,
        operation,
      );
    },
  });

  // GET by seqNo
  app.get("/:seqNo", {
    schema: {
      description: "Get an operation by sequence number",
      tags: ["Operations"],
      params: OpParamsSchema,
      response: {
        200: OperationSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;

      const resolved = await resolveRevision(orderKey, revNo);
      if (!resolved) {
        return notFound(reply, `Revision not found`);
      }

      const operation = await getOperation(resolved.rev.id, seqNo);
      if (!operation) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      return formatOperation(
        orderKey,
        revNo,
        resolved.rev.status,
        request.erpUser,
        operation,
      );
    },
  });

  // UPDATE (draft only)
  app.put("/:seqNo", {
    schema: {
      description: "Update an operation (draft revision only)",
      tags: ["Operations"],
      params: OpParamsSchema,
      body: UpdateOperationSchema,
      response: {
        200: OperationSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;
      const { title, description, seqNo: newSeqNo } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveRevision(orderKey, revNo);
      if (!resolved) {
        return notFound(reply, `Revision not found`);
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot update operations on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await findExisting(resolved.rev.id, seqNo);
      if (!existing) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      const operation = await updateOperation(
        existing.id,
        { title, description, seqNo: newSeqNo },
        userId,
      );

      return formatOperation(
        orderKey,
        revNo,
        resolved.rev.status,
        request.erpUser,
        operation,
      );
    },
  });

  // DELETE (draft only)
  app.delete("/:seqNo", {
    schema: {
      description: "Delete an operation (draft revision only)",
      tags: ["Operations"],
      params: OpParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;

      const resolved = await resolveRevision(orderKey, revNo);
      if (!resolved) {
        return notFound(reply, `Revision not found`);
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot delete operations on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await findExisting(resolved.rev.id, seqNo);
      if (!existing) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      await deleteOperation(existing.id);
      reply.status(204);
    },
  });
}
