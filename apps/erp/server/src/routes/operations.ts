import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateOperationSchema,
  ErrorResponseSchema,
  OperationListResponseSchema,
  OperationSchema,
  UpdateOperationSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import type { OperationModel } from "../generated/prisma/models/Operation.js";
import { API_PREFIX, schemaLink, selfLink } from "../hateoas.js";

const ParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
});

const OpParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

const includeUsers = {
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

type OpWithUsers = OperationModel & {
  createdBy: { username: string };
  updatedBy: { username: string };
};

function opBasePath(orderKey: string, revNo: number) {
  return `/orders/${orderKey}/revs/${revNo}/ops`;
}

function opItemLinks(
  orderKey: string,
  revNo: number,
  seqNo: number,
): HateoasLink[] {
  const base = opBasePath(orderKey, revNo);
  return [
    selfLink(`${base}/${seqNo}`),
    {
      rel: "collection",
      href: `${API_PREFIX}${base}`,
      title: "Operations",
    },
    {
      rel: "parent",
      href: `${API_PREFIX}/orders/${orderKey}/revs/${revNo}`,
      title: "Revision",
    },
    schemaLink("Operation"),
  ];
}

function opItemActions(
  orderKey: string,
  revNo: number,
  seqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "manage_orders") || revStatus !== "draft") return [];

  const href = `${API_PREFIX}${opBasePath(orderKey, revNo)}/${seqNo}`;
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateOperation`,
    },
    {
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
    },
  ];
}

function formatItem(
  orderKey: string,
  revNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  item: OpWithUsers,
) {
  return {
    id: item.id,
    orderRevId: item.orderRevId,
    seqNo: item.seqNo,
    title: item.title,
    description: item.description,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy.username,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedBy.username,
    _links: opItemLinks(orderKey, revNo, item.seqNo),
    _actions: opItemActions(orderKey, revNo, item.seqNo, revStatus, user),
  };
}

async function resolveRevision(orderKey: string, revNo: number) {
  const order = await erpDb.order.findUnique({ where: { key: orderKey } });
  if (!order) return null;

  const rev = await erpDb.orderRevision.findFirst({
    where: { orderId: order.id, revNo },
  });
  if (!rev) return null;

  return { order, rev };
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
        return sendError(reply, 404, "Not Found", `Revision not found`);
      }

      const items = await erpDb.operation.findMany({
        where: { orderRevId: resolved.rev.id },
        include: includeUsers,
        orderBy: { seqNo: "asc" },
      });

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;
      const nextSeqNo = Math.ceil((maxSeq + 1) / 10) * 10;

      const user = request.erpUser;
      const base = opBasePath(orderKey, revNo);
      return {
        items: items.map((item) =>
          formatItem(orderKey, revNo, resolved.rev.status, user, item),
        ),
        total: items.length,
        nextSeqNo,
        _links: [selfLink(base)],
        _actions:
          hasPermission(user, "manage_orders") &&
          resolved.rev.status === "draft"
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
        return sendError(reply, 404, "Not Found", `Revision not found`);
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot add operations to a ${resolved.rev.status} revision`,
        );
      }

      const item = await erpDb.$transaction(async (erpTx) => {
        const maxSeq = await erpTx.operation.findFirst({
          where: { orderRevId: resolved.rev.id },
          orderBy: { seqNo: "desc" },
          select: { seqNo: true },
        });
        const defaultSeqNo = Math.ceil(((maxSeq?.seqNo ?? 0) + 1) / 10) * 10;
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
        return sendError(reply, 404, "Not Found", `Revision not found`);
      }

      const item = await erpDb.operation.findFirst({
        where: { orderRevId: resolved.rev.id, seqNo },
        include: includeUsers,
      });
      if (!item) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation ${seqNo} not found`,
        );
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
        return sendError(reply, 404, "Not Found", `Revision not found`);
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot update operations on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.operation.findFirst({
        where: { orderRevId: resolved.rev.id, seqNo },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation ${seqNo} not found`,
        );
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
        return sendError(reply, 404, "Not Found", `Revision not found`);
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot delete operations on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.operation.findFirst({
        where: { orderRevId: resolved.rev.id, seqNo },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Operation ${seqNo} not found`,
        );
      }

      await erpDb.operation.delete({ where: { id: existing.id } });
      reply.status(204);
    },
  });
}
