import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  CreateStepFieldSchema,
  ErrorResponseSchema,
  StepFieldListResponseSchema,
  StepFieldSchema,
  UpdateStepFieldSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import type { StepFieldModel } from "../generated/prisma/models/StepField.js";
import { API_PREFIX, schemaLink, selfLink } from "../hateoas.js";

const ParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
});

const FieldParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
  fieldSeqNo: z.coerce.number().int(),
});

const includeUsers = {
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type StepFieldWithUsers = StepFieldModel & {
  createdBy: { username: string };
  updatedBy: { username: string };
};

export function formatFieldListResponse(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  items: StepFieldWithUsers[],
) {
  const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;
  const nextSeqNo = Math.ceil((maxSeq + 1) / 10) * 10;
  const base = fieldBasePath(orderKey, revNo, opSeqNo, stepSeqNo);
  return {
    items: items.map((item) =>
      formatFieldItem(
        orderKey,
        revNo,
        opSeqNo,
        stepSeqNo,
        revStatus,
        user,
        item,
      ),
    ),
    total: items.length,
    nextSeqNo,
    _links: [selfLink(base)],
    _actions:
      hasPermission(user, "manage_orders") && revStatus === "draft"
        ? [
            {
              rel: "create" as const,
              href: `${API_PREFIX}${base}`,
              method: "POST" as const,
              title: "Add Field",
              schema: `${API_PREFIX}/schemas/CreateStepField`,
            },
          ]
        : [],
  };
}

export function fieldBasePath(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
) {
  return `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps/${stepSeqNo}/fields`;
}

export function fieldItemLinks(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  fieldSeqNo: number,
): HateoasLink[] {
  const base = fieldBasePath(orderKey, revNo, opSeqNo, stepSeqNo);
  return [
    selfLink(`${base}/${fieldSeqNo}`),
    {
      rel: "collection",
      href: `${API_PREFIX}${base}`,
      title: "Step Fields",
    },
    {
      rel: "parent",
      href: `${API_PREFIX}/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps/${stepSeqNo}`,
      title: "Step",
    },
    schemaLink("StepField"),
  ];
}

export function fieldItemActions(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  fieldSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "manage_orders") || revStatus !== "draft") return [];

  const href = `${API_PREFIX}${fieldBasePath(orderKey, revNo, opSeqNo, stepSeqNo)}/${fieldSeqNo}`;
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateStepField`,
    },
    {
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
    },
  ];
}

export function formatFieldItem(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  item: StepFieldWithUsers,
) {
  return {
    id: item.id,
    stepId: item.stepId,
    seqNo: item.seqNo,
    label: item.label,
    type: item.type,
    required: item.required,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy.username,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedBy.username,
    _links: fieldItemLinks(orderKey, revNo, opSeqNo, stepSeqNo, item.seqNo),
    _actions: fieldItemActions(
      orderKey,
      revNo,
      opSeqNo,
      stepSeqNo,
      item.seqNo,
      revStatus,
      user,
    ),
  };
}

async function resolveStep(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
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

  const step = await erpDb.step.findFirst({
    where: { operationId: operation.id, seqNo: stepSeqNo },
  });
  if (!step) return null;

  return { order, rev, operation, step };
}

export default function stepFieldRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List fields for a step",
      tags: ["Step Fields"],
      params: ParamsSchema,
      response: {
        200: StepFieldListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Step not found");
      }

      const items = await erpDb.stepField.findMany({
        where: { stepId: resolved.step.id },
        include: includeUsers,
        orderBy: { seqNo: "asc" },
      });

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;
      const nextSeqNo = Math.ceil((maxSeq + 1) / 10) * 10;

      const user = request.erpUser;
      const base = fieldBasePath(orderKey, revNo, seqNo, stepSeqNo);
      return {
        items: items.map((item) =>
          formatFieldItem(
            orderKey,
            revNo,
            seqNo,
            stepSeqNo,
            resolved.rev.status,
            user,
            item,
          ),
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
                  title: "Add Field",
                  schema: `${API_PREFIX}/schemas/CreateStepField`,
                },
              ]
            : [],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a field for a step",
      tags: ["Step Fields"],
      params: ParamsSchema,
      body: CreateStepFieldSchema,
      response: {
        201: StepFieldSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;
      const { seqNo: requestedSeqNo, label, type, required } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Step not found");
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot add fields to a ${resolved.rev.status} revision`,
        );
      }

      const item = await erpDb.$transaction(async (erpTx) => {
        const maxSeq = await erpTx.stepField.findFirst({
          where: { stepId: resolved.step.id },
          orderBy: { seqNo: "desc" },
          select: { seqNo: true },
        });
        const defaultSeqNo = Math.ceil(((maxSeq?.seqNo ?? 0) + 1) / 10) * 10;
        const nextSeqNo = requestedSeqNo ?? defaultSeqNo;

        return erpTx.stepField.create({
          data: {
            stepId: resolved.step.id,
            seqNo: nextSeqNo,
            label,
            type: type ?? "string",
            required: required ?? false,
            createdById: userId,
            updatedById: userId,
          },
          include: includeUsers,
        });
      });

      reply.status(201);
      return formatFieldItem(
        orderKey,
        revNo,
        seqNo,
        stepSeqNo,
        resolved.rev.status,
        request.erpUser,
        item,
      );
    },
  });

  // GET by fieldSeqNo
  app.get("/:fieldSeqNo", {
    schema: {
      description: "Get a step field by sequence number",
      tags: ["Step Fields"],
      params: FieldParamsSchema,
      response: {
        200: StepFieldSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo, fieldSeqNo } =
        request.params;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Step not found");
      }

      const item = await erpDb.stepField.findFirst({
        where: { stepId: resolved.step.id, seqNo: fieldSeqNo },
        include: includeUsers,
      });
      if (!item) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Field ${fieldSeqNo} not found`,
        );
      }

      return formatFieldItem(
        orderKey,
        revNo,
        seqNo,
        stepSeqNo,
        resolved.rev.status,
        request.erpUser,
        item,
      );
    },
  });

  // UPDATE (draft only)
  app.put("/:fieldSeqNo", {
    schema: {
      description: "Update a step field (draft revision only)",
      tags: ["Step Fields"],
      params: FieldParamsSchema,
      body: UpdateStepFieldSchema,
      response: {
        200: StepFieldSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo, fieldSeqNo } =
        request.params;
      const {
        label,
        type,
        required,
        seqNo: newSeqNo,
      } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Step not found");
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot update fields on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.stepField.findFirst({
        where: { stepId: resolved.step.id, seqNo: fieldSeqNo },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Field ${fieldSeqNo} not found`,
        );
      }

      const item = await erpDb.stepField.update({
        where: { id: existing.id },
        data: {
          ...(label !== undefined ? { label } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(required !== undefined ? { required } : {}),
          ...(newSeqNo !== undefined ? { seqNo: newSeqNo } : {}),
          updatedById: userId,
        },
        include: includeUsers,
      });

      return formatFieldItem(
        orderKey,
        revNo,
        seqNo,
        stepSeqNo,
        resolved.rev.status,
        request.erpUser,
        item,
      );
    },
  });

  // DELETE (draft only)
  app.delete("/:fieldSeqNo", {
    schema: {
      description: "Delete a step field (draft revision only)",
      tags: ["Step Fields"],
      params: FieldParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo, fieldSeqNo } =
        request.params;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", "Step not found");
      }

      if (resolved.rev.status !== "draft") {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot delete fields on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.stepField.findFirst({
        where: { stepId: resolved.step.id, seqNo: fieldSeqNo },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Field ${fieldSeqNo} not found`,
        );
      }

      await erpDb.stepField.delete({ where: { id: existing.id } });
      reply.status(204);
    },
  });
}
