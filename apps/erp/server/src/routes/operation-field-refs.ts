import {
  CreateFieldRefSchema,
  ErrorResponseSchema,
  FieldRefListResponseSchema,
  FieldRefSchema,
  RevisionStatus,
  SeqNoCreateResponseSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { requirePermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  type ActionDef,
  calcNextSeqNo,
  childItemLinks,
  mutationResult,
  resolveActions,
  resolveOperation,
} from "../route-helpers.js";
import {
  checkDuplicateSource,
  createFieldRef,
  deleteFieldRef,
  type FieldRefWithDetails,
  findExistingFieldRef,
  listFieldRefs,
} from "../services/field-ref-service.js";

const ParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

const RefParamsSchema = z.object({
  orderKey: z.string(),
  revNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  refSeqNo: z.coerce.number().int(),
});

function basePath(orderKey: string, revNo: number, seqNo: number) {
  return `/orders/${orderKey}/revs/${revNo}/ops/${seqNo}/field-refs`;
}

function formatFieldRef(
  orderKey: string,
  revNo: number,
  seqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  ref: FieldRefWithDetails,
) {
  const base = basePath(orderKey, revNo, seqNo);
  return {
    id: ref.id,
    seqNo: ref.seqNo,
    title: ref.title,
    sourceOpSeqNo: ref.sourceStep.operation.seqNo,
    sourceOpTitle: ref.sourceStep.operation.title,
    sourceStepSeqNo: ref.sourceStep.seqNo,
    sourceStepTitle: ref.sourceStep.title,
    fields: (ref.sourceStep.fieldSet?.fields ?? []).map((f) => ({
      seqNo: f.seqNo,
      label: f.label,
      type: f.type,
    })),
    createdAt: ref.createdAt.toISOString(),
    createdBy: ref.createdBy.username,
    _links: childItemLinks(
      base,
      ref.seqNo,
      "Field Refs",
      `/orders/${orderKey}/revs/${revNo}/ops/${seqNo}`,
      "Operation",
      "FieldRef",
    ),
    _actions: deleteAction(
      `${API_PREFIX}${base}/${ref.seqNo}`,
      revStatus,
      user,
    ),
  };
}

function deleteAction(
  href: string,
  revStatus: string,
  user: ErpUser | undefined,
) {
  return resolveActions(
    [
      {
        rel: "delete",
        method: "DELETE",
        title: "Remove Reference",
        permission: "order_planner",
        statuses: [RevisionStatus.draft],
        hideWithoutPermission: true,
      } as ActionDef<{ status: string }>,
    ],
    href,
    { status: revStatus, user },
  );
}

const draftCreateDef: ActionDef<{ status: string }> = {
  rel: "create",
  method: "POST",
  title: "Add Field Reference",
  schema: `${API_PREFIX}/schemas/CreateFieldRef`,
  permission: "order_planner",
  disabledWhen: (ctx) =>
    ctx.status !== RevisionStatus.draft
      ? "Can only add field references in draft revisions"
      : null,
};

// Schema for the /available response
const AvailableStepSchema = z.object({
  opSeqNo: z.number(),
  opTitle: z.string(),
  stepSeqNo: z.number(),
  stepTitle: z.string(),
  stepId: z.number(),
  fieldCount: z.number(),
});

const AvailableStepsResponseSchema = z.object({
  items: z.array(AvailableStepSchema),
});

export default function operationFieldRefRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST available steps with fields (for the "add reference" dialog)
  app.get("/available", {
    schema: {
      description:
        "List steps with fields in the same revision that can be referenced",
      tags: ["Operation Field Refs"],
      params: ParamsSchema,
      response: {
        200: AvailableStepsResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation not found");
      }

      // Find all steps in this revision that have fields
      const steps = await erpDb.step.findMany({
        where: {
          operation: { orderRevId: resolved.rev.id },
          fieldSetId: { not: null },
          fieldSet: { fields: { some: {} } },
        },
        select: {
          id: true,
          seqNo: true,
          title: true,
          operation: { select: { seqNo: true, title: true } },
          fieldSet: { select: { _count: { select: { fields: true } } } },
        },
        orderBy: [{ operation: { seqNo: "asc" } }, { seqNo: "asc" }],
      });

      // Exclude steps already referenced by this operation
      const existingRefs = await erpDb.operationFieldRef.findMany({
        where: { operationId: resolved.operation.id },
        select: { sourceStepId: true },
      });
      const refSet = new Set(existingRefs.map((r) => r.sourceStepId));

      return {
        items: steps
          .filter((s) => !refSet.has(s.id))
          .map((s) => ({
            opSeqNo: s.operation.seqNo,
            opTitle: s.operation.title,
            stepSeqNo: s.seqNo,
            stepTitle: s.title,
            stepId: s.id,
            fieldCount: s.fieldSet?._count.fields ?? 0,
          })),
      };
    },
  });

  // LIST
  app.get("/", {
    schema: {
      description: "List field references for an operation",
      tags: ["Operation Field Refs"],
      params: ParamsSchema,
      response: {
        200: FieldRefListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation not found");
      }

      const items = await listFieldRefs(resolved.operation.id);
      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;
      const base = basePath(orderKey, revNo, seqNo);

      return {
        items: items.map((ref) => {
          const { _links, ...rest } = formatFieldRef(
            orderKey,
            revNo,
            seqNo,
            resolved.rev.status,
            request.erpUser,
            ref,
          );
          return rest;
        }),
        total: items.length,
        nextSeqNo: calcNextSeqNo(maxSeq),
        _links: [selfLink(base)],
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}${base}/{seqNo}`,
          },
        ],
        _actions: resolveActions([draftCreateDef], `${API_PREFIX}${base}`, {
          status: resolved.rev.status,
          user: request.erpUser,
        }),
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description:
        "Add a field reference to an operation (draft revision only)",
      tags: ["Operation Field Refs"],
      params: ParamsSchema,
      body: CreateFieldRefSchema,
      response: {
        201: SeqNoCreateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;
      const {
        seqNo: requestedSeqNo,
        title,
        sourceOpSeqNo,
        sourceStepSeqNo,
      } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot add field references to a ${resolved.rev.status} revision`,
        );
      }

      // Resolve source step
      const sourceOp = await erpDb.operation.findFirst({
        where: { orderRevId: resolved.rev.id, seqNo: sourceOpSeqNo },
      });
      if (!sourceOp) {
        return notFound(reply, `Source operation ${sourceOpSeqNo} not found`);
      }

      const sourceStep = await erpDb.step.findFirst({
        where: { operationId: sourceOp.id, seqNo: sourceStepSeqNo },
        select: { id: true, fieldSetId: true },
      });
      if (!sourceStep) {
        return notFound(
          reply,
          `Source step ${sourceStepSeqNo} not found in operation ${sourceOpSeqNo}`,
        );
      }

      if (!sourceStep.fieldSetId) {
        return conflict(reply, "Source step has no fields");
      }

      // Check for duplicate
      const dup = await checkDuplicateSource(
        resolved.operation.id,
        sourceStep.id,
      );
      if (dup) {
        return conflict(reply, "This step is already referenced");
      }

      const ref = await createFieldRef(
        resolved.operation.id,
        requestedSeqNo,
        title,
        sourceStep.id,
        userId,
      );

      const full = formatFieldRef(
        orderKey,
        revNo,
        seqNo,
        resolved.rev.status,
        request.erpUser,
        ref,
      );
      reply.status(201);
      return mutationResult(request, reply, full, {
        id: full.id,
        seqNo: full.seqNo,
        _links: full._links,
        _actions: full._actions,
      });
    },
  });

  // DELETE
  app.delete("/:refSeqNo", {
    schema: {
      description:
        "Remove a field reference from an operation (draft revision only)",
      tags: ["Operation Field Refs"],
      params: RefParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, refSeqNo } = request.params;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot remove field references from a ${resolved.rev.status} revision`,
        );
      }

      const existing = await findExistingFieldRef(
        resolved.operation.id,
        refSeqNo,
      );
      if (!existing) {
        return notFound(reply, `Field reference ${refSeqNo} not found`);
      }

      await deleteFieldRef(existing.id);
      reply.status(204);
    },
  });
}
