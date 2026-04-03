import {
  BatchCreateStepSchema,
  BatchSeqNoCreateResponseSchema,
  CreateStepSchema,
  ErrorResponseSchema,
  MutateResponseSchema,
  RevisionStatus,
  SeqNoCreateResponseSchema,
  StepListResponseSchema,
  StepSchema,
  UpdateStepSchema,
} from "@naisys/erp-shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { requirePermission } from "../auth-middleware.js";
import { conflict, notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  type ActionDef,
  calcNextSeqNo,
  childItemLinks,
  draftCrudActions,
  formatAuditFields,
  mutationResult,
  resolveActions,
  resolveOperation,
} from "../route-helpers.js";
import {
  createStep,
  createSteps,
  deleteStep,
  findExisting,
  getStep,
  listSteps,
  type StepWithUsersAndFields,
  updateStep,
} from "../services/step-service.js";
import { formatFieldListResponse } from "./step-fields.js";

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

function stepBasePath(orderKey: string, revNo: number, opSeqNo: number) {
  return `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps`;
}

function formatStep(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  step: StepWithUsersAndFields,
) {
  return {
    id: step.id,
    operationId: step.operationId,
    seqNo: step.seqNo,
    title: step.title,
    instructions: step.instructions,
    multiSet: step.multiSet,
    fieldCount: step.fieldSet?.fields.length ?? 0,
    ...formatAuditFields(step),
    fields: formatFieldListResponse(
      orderKey,
      revNo,
      opSeqNo,
      step.seqNo,
      revStatus,
      user,
      step.fieldSet?.fields ?? [],
    ),
    _links: childItemLinks(
      stepBasePath(orderKey, revNo, opSeqNo),
      step.seqNo,
      "Steps",
      `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}`,
      "Operation",
      "Step",
    ),
    _actions: draftCrudActions(
      `${API_PREFIX}${stepBasePath(orderKey, revNo, opSeqNo)}/${step.seqNo}`,
      "UpdateStep",
      revStatus,
      user,
    ),
  };
}

const draftCreateDef: ActionDef<{ status: string }> = {
  rel: "create",
  method: "POST",
  title: "Add Step",
  schema: `${API_PREFIX}/schemas/CreateStep`,
  permission: "order_planner",
  disabledWhen: (ctx) =>
    ctx.status !== RevisionStatus.draft
      ? "Can only add steps in draft revisions"
      : null,
};

const draftBatchCreateDef: ActionDef<{ status: string }> = {
  rel: "batch-create",
  path: "/batch",
  method: "POST",
  title: "Add Steps (Batch)",
  schema: `${API_PREFIX}/schemas/BatchCreateStep`,
  permission: "order_planner",
  disabledWhen: (ctx) =>
    ctx.status !== RevisionStatus.draft
      ? "Can only add steps in draft revisions"
      : null,
};

function stepListActions(
  base: string,
  revStatus: string,
  user: ErpUser | undefined,
) {
  return resolveActions(
    [draftCreateDef, draftBatchCreateDef],
    `${API_PREFIX}${base}`,
    { status: revStatus, user },
  );
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
        return notFound(reply, "Operation not found");
      }

      const items = await listSteps(resolved.operation.id);

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;

      const user = request.erpUser;
      const base = stepBasePath(orderKey, revNo, seqNo);
      return {
        items: items.map((step) => {
          const { _links, ...rest } = formatStep(
            orderKey,
            revNo,
            seqNo,
            resolved.rev.status,
            user,
            step,
          );
          return rest;
        }),
        total: items.length,
        nextSeqNo: calcNextSeqNo(maxSeq),
        _links: [selfLink(base)],
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}${stepBasePath(orderKey, revNo, seqNo)}/{seqNo}`,
          },
        ],
        _actions: stepListActions(base, resolved.rev.status, user),
      };
    },
  });

  // BATCH CREATE
  app.post("/batch", {
    schema: {
      description: "Create multiple steps for an operation in one request",
      tags: ["Steps"],
      params: ParamsSchema,
      body: BatchCreateStepSchema,
      response: {
        201: BatchSeqNoCreateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo } = request.params;
      const { items } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot add steps to a ${resolved.rev.status} revision`,
        );
      }

      const created = await createSteps(resolved.operation.id, items, userId);

      const maxSeq = created.length > 0 ? created[created.length - 1].seqNo : 0;
      const user = request.erpUser;
      const base = stepBasePath(orderKey, revNo, seqNo);

      const full = {
        items: created.map((step) => {
          const { _links, ...rest } = formatStep(
            orderKey,
            revNo,
            seqNo,
            resolved.rev.status,
            user,
            step,
          );
          return rest;
        }),
        total: created.length,
        nextSeqNo: calcNextSeqNo(maxSeq),
        _links: [selfLink(base)],
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}${stepBasePath(orderKey, revNo, seqNo)}/{seqNo}`,
          },
        ],
        _actions: [],
      };
      reply.status(201);
      return mutationResult(request, reply, full, {
        items: created.map((s) => ({ id: s.id, seqNo: s.seqNo })),
        total: created.length,
        _actions: full._actions,
      });
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
        instructions,
        multiSet,
      } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot add steps to a ${resolved.rev.status} revision`,
        );
      }

      const step = await createStep(
        resolved.operation.id,
        requestedSeqNo,
        title,
        instructions,
        multiSet,
        userId,
      );

      const full = formatStep(
        orderKey,
        revNo,
        seqNo,
        resolved.rev.status,
        request.erpUser,
        step,
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
        return notFound(reply, "Operation not found");
      }

      const step = await getStep(resolved.operation.id, stepSeqNo);
      if (!step) {
        return notFound(reply, `Step ${stepSeqNo} not found`);
      }

      return formatStep(
        orderKey,
        revNo,
        seqNo,
        resolved.rev.status,
        request.erpUser,
        step,
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
        200: MutateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;
      const { title, instructions, seqNo: newSeqNo, multiSet } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot update steps on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await findExisting(resolved.operation.id, stepSeqNo);
      if (!existing) {
        return notFound(reply, `Step ${stepSeqNo} not found`);
      }

      const step = await updateStep(
        existing.id,
        { title, instructions, seqNo: newSeqNo, multiSet },
        userId,
      );

      const full = formatStep(
        orderKey,
        revNo,
        seqNo,
        resolved.rev.status,
        request.erpUser,
        step,
      );
      return mutationResult(request, reply, full, {
        _actions: full._actions,
      });
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
    preHandler: requirePermission("order_planner"),
    handler: async (request, reply) => {
      const { orderKey, revNo, seqNo, stepSeqNo } = request.params;

      const resolved = await resolveOperation(orderKey, revNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot delete steps on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await findExisting(resolved.operation.id, stepSeqNo);
      if (!existing) {
        return notFound(reply, `Step ${stepSeqNo} not found`);
      }

      await deleteStep(existing.id);
      reply.status(204);
    },
  });
}
