import {
  CreateFieldSchema,
  ErrorResponseSchema,
  FieldListResponseSchema,
  FieldSchema,
  RevisionStatus,
  UpdateFieldSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  calcNextSeqNo,
  childItemLinks,
  draftCrudActions,
  formatAuditFields,
  permGate,
  resolveStep,
} from "../route-helpers.js";
import {
  createField,
  deleteField,
  ensureFieldSet,
  type FieldWithUsers,
  findExistingField,
  getField,
  listFields,
  updateField,
} from "../services/field-service.js";

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

export { type FieldWithUsers } from "../services/field-service.js";

export function formatFieldListResponse(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  items: FieldWithUsers[],
) {
  const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;
  const base = fieldBasePath(orderKey, revNo, opSeqNo, stepSeqNo);
  return {
    items: items.map((field) =>
      formatField(orderKey, revNo, opSeqNo, stepSeqNo, revStatus, user, field),
    ),
    total: items.length,
    nextSeqNo: calcNextSeqNo(maxSeq),
    _links: [selfLink(base)],
    _actions: [{
      rel: "create" as const,
      href: `${API_PREFIX}${base}`,
      method: "POST" as const,
      title: "Add Field",
      schema: `${API_PREFIX}/schemas/CreateField`,
      ...(!hasPermission(user, "order_planner")
        ? permGate(false, "order_planner")
        : revStatus !== RevisionStatus.draft
          ? { disabled: true, disabledReason: "Can only add fields in draft revisions" }
          : {}),
    }],
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

export function formatField(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  field: FieldWithUsers,
) {
  const base = fieldBasePath(orderKey, revNo, opSeqNo, stepSeqNo);
  return {
    id: field.id,
    fieldSetId: field.fieldSetId,
    seqNo: field.seqNo,
    label: field.label,
    type: field.type,
    multiValue: field.multiValue,
    required: field.required,
    ...formatAuditFields(field),
    _links: childItemLinks(
      base,
      field.seqNo,
      "Fields",
      `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps/${stepSeqNo}`,
      "Step",
      "Field",
    ),
    _actions: draftCrudActions(
      `${API_PREFIX}${base}/${field.seqNo}`,
      "UpdateField",
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
        200: FieldListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, "Step not found");
      }

      const items = resolved.step.fieldSetId
        ? await listFields(resolved.step.fieldSetId)
        : [];

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;

      const user = request.erpUser;
      const base = fieldBasePath(orderKey, revNo, seqNo, stepSeqNo);
      return {
        items: items.map((field) =>
          formatField(
            orderKey,
            revNo,
            seqNo,
            stepSeqNo,
            resolved.rev.status,
            user,
            field,
          ),
        ),
        total: items.length,
        nextSeqNo: calcNextSeqNo(maxSeq),
        _links: [selfLink(base)],
        _actions: [{
          rel: "create",
          href: `${API_PREFIX}${base}`,
          method: "POST" as const,
          title: "Add Field",
          schema: `${API_PREFIX}/schemas/CreateField`,
          ...(!hasPermission(user, "order_planner")
            ? permGate(false, "order_planner")
            : resolved.rev.status !== RevisionStatus.draft
              ? { disabled: true, disabledReason: "Can only add fields in draft revisions" }
              : {}),
        }],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a field for a step",
      tags: ["Step Fields"],
      params: ParamsSchema,
      body: CreateFieldSchema,
      response: {
        201: FieldSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;
      const {
        seqNo: requestedSeqNo,
        label,
        type,
        multiValue,
        required,
      } = request.body;
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

      // Ensure step has a field set
      let fieldSetId = resolved.step.fieldSetId;
      if (!fieldSetId) {
        fieldSetId = await ensureFieldSet(null, userId);
        await erpDb.step.update({
          where: { id: resolved.step.id },
          data: { fieldSetId },
        });
      }

      const field = await createField(
        fieldSetId,
        { seqNo: requestedSeqNo, label, type, multiValue, required },
        userId,
      );

      reply.status(201);
      return formatField(
        orderKey,
        revNo,
        seqNo,
        stepSeqNo,
        resolved.rev.status,
        request.erpUser,
        field,
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
        200: FieldSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo, fieldSeqNo } = request.params;

      const resolved = await resolveStep(orderKey, revNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, "Step not found");
      }

      if (!resolved.step.fieldSetId) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
      }

      const field = await getField(resolved.step.fieldSetId, fieldSeqNo);
      if (!field) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
      }

      return formatField(
        orderKey,
        revNo,
        seqNo,
        stepSeqNo,
        resolved.rev.status,
        request.erpUser,
        field,
      );
    },
  });

  // UPDATE (draft only)
  app.put("/:fieldSeqNo", {
    schema: {
      description: "Update a step field (draft revision only)",
      tags: ["Step Fields"],
      params: FieldParamsSchema,
      body: UpdateFieldSchema,
      response: {
        200: FieldSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo, fieldSeqNo } = request.params;
      const {
        label,
        type,
        multiValue,
        required,
        seqNo: newSeqNo,
      } = request.body;
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

      if (!resolved.step.fieldSetId) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
      }

      const existing = await findExistingField(
        resolved.step.fieldSetId,
        fieldSeqNo,
      );
      if (!existing) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
      }

      const field = await updateField(
        existing.id,
        { label, type, multiValue, required, seqNo: newSeqNo },
        userId,
      );

      return formatField(
        orderKey,
        revNo,
        seqNo,
        stepSeqNo,
        resolved.rev.status,
        request.erpUser,
        field,
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
    preHandler: requirePermission("order_planner"),
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

      if (!resolved.step.fieldSetId) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
      }

      const existing = await findExistingField(
        resolved.step.fieldSetId,
        fieldSeqNo,
      );
      if (!existing) {
        return notFound(reply, `Field ${fieldSeqNo} not found`);
      }

      await deleteField(existing.id);
      reply.status(204);
    },
  });
}
