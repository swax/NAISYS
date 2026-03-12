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
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { conflict, notFound } from "../error-handler.js";
import type { OperationModel } from "../generated/prisma/models/Operation.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  calcNextSeqNo,
  childItemLinks,
  draftCrudActions,
  formatAuditFields,
  includeUsers,
  resolveRevision,
  type WithAuditUsers,
} from "../route-helpers.js";

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

function formatItem(
  orderKey: string,
  revNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  item: OperationModel & WithAuditUsers,
) {
  const base = opBasePath(orderKey, revNo);
  return {
    id: item.id,
    orderRevId: item.orderRevId,
    seqNo: item.seqNo,
    title: item.title,
    description: item.description,
    ...formatAuditFields(item),
    _links: childItemLinks(
      base,
      item.seqNo,
      "Operations",
      `/orders/${orderKey}/revs/${revNo}`,
      "Revision",
      "Operation",
    ),
    _actions: draftCrudActions(
      `${API_PREFIX}${base}/${item.seqNo}`,
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

      const items = await erpDb.operation.findMany({
        where: { orderRevId: resolved.rev.id },
        include: includeUsers,
        orderBy: { seqNo: "asc" },
      });

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;

      const user = request.erpUser;
      const base = opBasePath(orderKey, revNo);
      return {
        items: items.map((item) =>
          formatItem(orderKey, revNo, resolved.rev.status, user, item),
        ),
        total: items.length,
        nextSeqNo: calcNextSeqNo(maxSeq),
        _links: [selfLink(base)],
        _actions:
          hasPermission(user, "manage_orders") &&
          resolved.rev.status === RevisionStatus.draft
            ? [
                {
                  rel: "create",
                  href: `${API_PREFIX}${base}`,
                  method: "POST" as const,
                  title: "Add Operation",
                  schema: `${API_PREFIX}/schemas/CreateOperation`,
                },
              ]
            : [],
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

      const item = await erpDb.$transaction(async (erpTx) => {
        const maxSeq = await erpTx.operation.findFirst({
          where: { orderRevId: resolved.rev.id },
          orderBy: { seqNo: "desc" },
          select: { seqNo: true },
        });
        const defaultSeqNo = calcNextSeqNo(maxSeq?.seqNo ?? 0);
        const nextSeqNo = requestedSeqNo ?? defaultSeqNo;

        return erpTx.operation.create({
          data: {
            orderRevId: resolved.rev.id,
            seqNo: nextSeqNo,
            title,
            description: description ?? "",
            createdById: userId,
            updatedById: userId,
          },
          include: includeUsers,
        });
      });

      reply.status(201);
      return formatItem(
        orderKey,
        revNo,
        resolved.rev.status,
        request.erpUser,
        item,
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

      const item = await erpDb.operation.findFirst({
        where: { orderRevId: resolved.rev.id, seqNo },
        include: includeUsers,
      });
      if (!item) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      return formatItem(
        orderKey,
        revNo,
        resolved.rev.status,
        request.erpUser,
        item,
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

      const existing = await erpDb.operation.findFirst({
        where: { orderRevId: resolved.rev.id, seqNo },
      });
      if (!existing) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      const item = await erpDb.operation.update({
        where: { id: existing.id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(newSeqNo !== undefined ? { seqNo: newSeqNo } : {}),
          updatedById: userId,
        },
        include: includeUsers,
      });

      return formatItem(
        orderKey,
        revNo,
        resolved.rev.status,
        request.erpUser,
        item,
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

      const existing = await erpDb.operation.findFirst({
        where: { orderRevId: resolved.rev.id, seqNo },
      });
      if (!existing) {
        return notFound(reply, `Operation ${seqNo} not found`);
      }

      await erpDb.operation.delete({ where: { id: existing.id } });
      reply.status(204);
    },
  });
}
