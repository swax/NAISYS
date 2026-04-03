import {
  CreateOperationDependencySchema,
  CreateResponseSchema,
  ErrorResponseSchema,
  OperationDependencyListResponseSchema,
  RevisionStatus,
} from "@naisys/erp-shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import { mutationResult, resolveRevision } from "../route-helpers.js";
import {
  createDependency,
  deleteDependency,
  type DependencyWithDetails,
  listDependencies,
} from "../services/operation-dependency-service.js";
import { findExisting } from "../services/operation-service.js";

const ParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

const DepParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  predecessorSeqNo: z.coerce.number().int(),
});

function depBasePath(orderKey: string, revNo: number, seqNo: number) {
  return `/orders/${orderKey}/revs/${revNo}/ops/${seqNo}/deps`;
}

function formatDependency(dep: DependencyWithDetails) {
  return {
    id: dep.id,
    predecessorSeqNo: dep.predecessor.seqNo,
    predecessorTitle: dep.predecessor.title,
    createdAt: dep.createdAt.toISOString(),
    createdBy: dep.createdBy.username,
  };
}

function depActionTemplates(
  basePath: string,
  revStatus: string,
  user: ErpUser | undefined,
) {
  if (
    !hasPermission(user, "order_planner") ||
    revStatus !== RevisionStatus.draft
  )
    return [];
  return [
    {
      rel: "deleteDependency",
      hrefTemplate: `${API_PREFIX}${basePath}/{predecessorSeqNo}`,
      method: "DELETE" as const,
      title: "Remove Dependency",
    },
  ];
}

export default function operationDependencyRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST dependencies (predecessors) for an operation
  app.get("/", {
    schema: {
      description: "List predecessor dependencies for an operation",
      tags: ["Operation Dependencies"],
      params: ParamsSchema,
      response: {
        200: OperationDependencyListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;

      const resolved = await resolveRevision(orderKey, revNo);
      if (!resolved) {
        return notFound(reply, "Revision not found");
      }

      const operation = await findExisting(resolved.rev.id, seqNo);
      if (!operation) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      const items = await listDependencies(operation.id);
      const user = request.erpUser;
      const base = depBasePath(orderKey, revNo, seqNo);

      return {
        items: items.map((dep) => formatDependency(dep)),
        total: items.length,
        _links: [selfLink(base)],
        _actions:
          hasPermission(user, "order_planner") &&
          resolved.rev.status === RevisionStatus.draft
            ? [
                {
                  rel: "create",
                  href: `${API_PREFIX}${base}`,
                  method: "POST" as const,
                  title: "Add Dependency",
                  schema: `${API_PREFIX}/schemas/CreateOperationDependency`,
                },
              ]
            : [],
        _actionTemplates: depActionTemplates(base, resolved.rev.status, user),
      };
    },
  });

  // CREATE a dependency
  app.post("/", {
    schema: {
      description: "Add a predecessor dependency to an operation",
      tags: ["Operation Dependencies"],
      params: ParamsSchema,
      body: CreateOperationDependencySchema,
      response: {
        201: CreateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;
      const { predecessorSeqNo } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveRevision(orderKey, revNo);
      if (!resolved) {
        return notFound(reply, "Revision not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot modify dependencies on a ${resolved.rev.status} revision`,
        );
      }

      const successor = await findExisting(resolved.rev.id, seqNo);
      if (!successor) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      const predecessor = await findExisting(resolved.rev.id, predecessorSeqNo);
      if (!predecessor) {
        return notFound(
          reply,
          `Predecessor operation ${predecessorSeqNo} not found`,
        );
      }

      if (successor.id === predecessor.id) {
        return conflict(reply, "An operation cannot depend on itself");
      }

      const dep = await createDependency(successor.id, predecessor.id, userId);

      const full = formatDependency(dep);
      reply.status(201);
      return mutationResult(request, reply, full, {
        id: full.id,
      });
    },
  });

  // DELETE a dependency
  app.delete("/:predecessorSeqNo", {
    schema: {
      description: "Remove a predecessor dependency from an operation",
      tags: ["Operation Dependencies"],
      params: DepParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, predecessorSeqNo } = request.params;

      const resolved = await resolveRevision(orderKey, revNo);
      if (!resolved) {
        return notFound(reply, "Revision not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot modify dependencies on a ${resolved.rev.status} revision`,
        );
      }

      const successor = await findExisting(resolved.rev.id, seqNo);
      if (!successor) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      const predecessor = await findExisting(resolved.rev.id, predecessorSeqNo);
      if (!predecessor) {
        return notFound(
          reply,
          `Predecessor operation ${predecessorSeqNo} not found`,
        );
      }

      await deleteDependency(successor.id, predecessor.id);
      reply.status(204);
    },
  });
}
