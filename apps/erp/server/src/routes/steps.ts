import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateStepSchema,
  ErrorResponseSchema,
  StepListResponseSchema,
  StepSchema,
  UpdateStepSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import type { StepModel } from "../generated/prisma/models/Step.js";
import { API_PREFIX, schemaLink, selfLink } from "../hateoas.js";

const ParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

const StepParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
});

const includeUsers = {
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

type StepWithUsers = StepModel & {
  createdBy: { username: string };
  updatedBy: { username: string };
};

function stepBasePath(orderKey: string, revNo: number, opSeqNo: number) {
  return `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps`;
}

function stepItemLinks(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
): HateoasLink[] {
  const base = stepBasePath(orderKey, revNo, opSeqNo);
  return [
    selfLink(`${base}/${stepSeqNo}`),
    {
      rel: "collection",
      href: `${API_PREFIX}${base}`,
      title: "Steps",
    },
    {
      rel: "parent",
      href: `${API_PREFIX}/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}`,
      title: "Operation",
    },
    schemaLink("Step"),
  ];
}

function stepItemActions(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "manage_orders") || revStatus !== "draft") return [];

  const href = `${API_PREFIX}${stepBasePath(orderKey, revNo, opSeqNo)}/${stepSeqNo}`;
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateStep`,
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
  opSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  item: StepWithUsers,
) {
  return {
    id: item.id,
    operationId: item.operationId,
    seqNo: item.seqNo,
    instructions: item.instructions,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy.username,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedBy.username,
    _links: stepItemLinks(orderKey, revNo, opSeqNo, item.seqNo),
    _actions: stepItemActions(
      orderKey,
      revNo,
      opSeqNo,
      item.seqNo,
      revStatus,
      user,
    ),
  };
}

async function resolveOperation(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
) {
  const order = await erpDb.order.findUnique({ where: { key: orderKey } });
  if (!order) return null;

  const rev = await erpDb.orderRevision.findFirst({
    where: { orderId: order.id, revNo },
  });
  if (!rev) return null;

  const operation = await erpDb.operation.findFirst({
    where: { orderRevId: rev.id, seqNo: opSeqNo },
  });
  if (!operation) return null;

  return { order, rev, operation };
}

export default function stepRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List steps for an operation",
      tags: ["Steps"],
      params: ParamsSchema,
      response: {
        200: StepListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Operation not found");
      }

      const items = await erpDb.step.findMany({
        where: { operationId: resolved.operation.id },
        include: includeUsers,
        orderBy: { seqNo: "asc" },
      });

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;
      const nextSeqNo = Math.ceil((maxSeq + 1) / 10) * 10;

      const user = request.erpUser;
      const base = stepBasePath(orderKey, revNo, seqNo);
      return {
        items: items.map((item) =>
          formatItem(orderKey, revNo, seqNo, resolved.rev.status, user, item),
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
                  title: "Add Step",
                  schema: `${API_PREFIX}/schemas/CreateStep`,
                },
              ]
            : [],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a step for an operation",
      tags: ["Steps"],
      params: ParamsSchema,
      body: CreateStepSchema,
      response: {
        201: StepSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;
      const { seqNo: requestedSeqNo, instructions } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Operation not found");
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot add steps to a ${resolved.rev.status} revision`,
        );
      }

      const item = await erpDb.$transaction(async (erpTx) => {
        const maxSeq = await erpTx.step.findFirst({
          where: { operationId: resolved.operation.id },
          orderBy: { seqNo: "desc" },
          select: { seqNo: true },
        });
        const defaultSeqNo = Math.ceil(((maxSeq?.seqNo ?? 0) + 1) / 10) * 10;
        const nextSeqNo = requestedSeqNo ?? defaultSeqNo;

        return erpTx.step.create({
          data: {
            operationId: resolved.operation.id,
            seqNo: nextSeqNo,
            instructions: instructions ?? "",
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
        seqNo,
        resolved.rev.status,
        request.erpUser,
        item,
      );
    },
  });

  // GET by stepSeqNo
  app.get("/:stepSeqNo", {
    schema: {
      description: "Get a step by sequence number",
      tags: ["Steps"],
      params: StepParamsSchema,
      response: {
        200: StepSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Operation not found");
      }

      const item = await erpDb.step.findFirst({
        where: { operationId: resolved.operation.id, seqNo: stepSeqNo },
        include: includeUsers,
      });
      if (!item) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Step ${stepSeqNo} not found`,
        );
      }

      return formatItem(
        orderKey,
        revNo,
        seqNo,
        resolved.rev.status,
        request.erpUser,
        item,
      );
    },
  });

  // UPDATE (draft only)
  app.put("/:stepSeqNo", {
    schema: {
      description: "Update a step (draft revision only)",
      tags: ["Steps"],
      params: StepParamsSchema,
      body: UpdateStepSchema,
      response: {
        200: StepSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;
      const { instructions, seqNo: newSeqNo } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Operation not found");
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot update steps on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.step.findFirst({
        where: { operationId: resolved.operation.id, seqNo: stepSeqNo },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Step ${stepSeqNo} not found`,
        );
      }

      const item = await erpDb.step.update({
        where: { id: existing.id },
        data: {
          ...(instructions !== undefined ? { instructions } : {}),
          ...(newSeqNo !== undefined ? { seqNo: newSeqNo } : {}),
          updatedById: userId,
        },
        include: includeUsers,
      });

      return formatItem(
        orderKey,
        revNo,
        seqNo,
        resolved.rev.status,
        request.erpUser,
        item,
      );
    },
  });

  // DELETE (draft only)
  app.delete("/:stepSeqNo", {
    schema: {
      description: "Delete a step (draft revision only)",
      tags: ["Steps"],
      params: StepParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Operation not found");
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot delete steps on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.step.findFirst({
        where: { operationId: resolved.operation.id, seqNo: stepSeqNo },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Step ${stepSeqNo} not found`,
        );
      }

      await erpDb.step.delete({ where: { id: existing.id } });
      reply.status(204);
    },
  });
}
