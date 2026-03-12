import {
  CreateStepFieldSchema,
  ErrorResponseSchema,
  RevisionStatus,
  StepFieldListResponseSchema,
  StepFieldSchema,
  StepFieldType,
  UpdateStepFieldSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { conflict, notFound } from "../error-handler.js";
import type { StepFieldModel } from "../generated/prisma/models/StepField.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  calcNextSeqNo,
  childItemLinks,
  draftCrudActions,
  formatAuditFields,
  includeUsers,
  resolveStep,
  type WithAuditUsers,
} from "../route-helpers.js";

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

export type StepFieldWithUsers = StepFieldModel & WithAuditUsers;

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
    nextSeqNo: calcNextSeqNo(maxSeq),
    _links: [selfLink(base)],
    _actions:
      hasPermission(user, "manage_orders") && revStatus === RevisionStatus.draft
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

export function formatFieldItem(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  item: StepFieldWithUsers,
) {
  const base = fieldBasePath(orderKey, revNo, opSeqNo, stepSeqNo);
  return {
    id: item.id,
    stepId: item.stepId,
    seqNo: item.seqNo,
    label: item.label,
    type: item.type,
    required: item.required,
    ...formatAuditFields(item),
    _links: childItemLinks(
      base,
      item.seqNo,
      "Step Fields",
      `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps/${stepSeqNo}`,
      "Step",
      "StepField",
    ),
    _actions: draftCrudActions(
      `${API_PREFIX}${base}/${item.seqNo}`,
      "UpdateStepField",
      revStatus,
      user,
    ),
  };
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
        return notFound(reply, "Step not found");
      }

      const items = await erpDb.stepField.findMany({
        where: { stepId: resolved.step.id },
        include: includeUsers,
        orderBy: { seqNo: "asc" },
      });

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;

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
        return notFound(reply, "Step not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot add fields to a ${resolved.rev.status} revision`,
        );
      }

      const item = await erpDb.$transaction(async (erpTx) => {
        const maxSeq = await erpTx.stepField.findFirst({
          where: { stepId: resolved.step.id },
          orderBy: { seqNo: "desc" },
          select: { seqNo: true },
        });
        const defaultSeqNo = calcNextSeqNo(maxSeq?.seqNo ?? 0);
        const nextSeqNo = requestedSeqNo ?? defaultSeqNo;

        return erpTx.stepField.create({
          data: {
            stepId: resolved.step.id,
            seqNo: nextSeqNo,
            label,
            type: type ?? StepFieldType.string,
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
      const { orderKey, revNo, seqNo, stepSeqNo, fieldSeqNo } = request.params;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, "Step not found");
      }

      const item = await erpDb.stepField.findFirst({
        where: { stepId: resolved.step.id, seqNo: fieldSeqNo },
        include: includeUsers,
      });
      if (!item) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
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
      const { orderKey, revNo, seqNo, stepSeqNo, fieldSeqNo } = request.params;
      const { label, type, required, seqNo: newSeqNo } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, "Step not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot update fields on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.stepField.findFirst({
        where: { stepId: resolved.step.id, seqNo: fieldSeqNo },
      });
      if (!existing) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
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
      const { orderKey, revNo, seqNo, stepSeqNo, fieldSeqNo } = request.params;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, "Step not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot delete fields on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.stepField.findFirst({
        where: { stepId: resolved.step.id, seqNo: fieldSeqNo },
      });
      if (!existing) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
      }

      await erpDb.stepField.delete({ where: { id: existing.id } });
      reply.status(204);
    },
  });
}
