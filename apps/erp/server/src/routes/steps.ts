import {
  CreateStepSchema,
  ErrorResponseSchema,
  RevisionStatus,
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
import { conflict, notFound } from "../error-handler.js";
import type { StepModel } from "../generated/prisma/models/Step.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  calcNextSeqNo,
  childItemLinks,
  draftCrudActions,
  formatAuditFields,
  includeUsers,
  resolveOperation,
  type WithAuditUsers,
} from "../route-helpers.js";
import {
  formatFieldListResponse,
  type StepFieldWithUsers,
} from "./step-fields.js";

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

const includeUsersAndFields = {
  ...includeUsers,
  fields: {
    include: includeUsers,
    orderBy: { seqNo: "asc" as const },
  },
} as const;

type StepWithUsersAndFields = StepModel &
  WithAuditUsers & {
    fields: StepFieldWithUsers[];
  };

function stepBasePath(orderKey: string, revNo: number, opSeqNo: number) {
  return `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps`;
}

function formatItem(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  revStatus: string,
  user: ErpUser | undefined,
  item: StepWithUsersAndFields,
) {
  return {
    id: item.id,
    operationId: item.operationId,
    seqNo: item.seqNo,
    instructions: item.instructions,
    ...formatAuditFields(item),
    fields: formatFieldListResponse(
      orderKey,
      revNo,
      opSeqNo,
      item.seqNo,
      revStatus,
      user,
      item.fields,
    ),
    _links: childItemLinks(
      stepBasePath(orderKey, revNo, opSeqNo),
      item.seqNo,
      "Steps",
      `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}`,
      "Operation",
      "Step",
    ),
    _actions: draftCrudActions(
      `${API_PREFIX}${stepBasePath(orderKey, revNo, opSeqNo)}/${item.seqNo}`,
      "UpdateStep",
      revStatus,
      user,
    ),
  };
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

      const items = await erpDb.step.findMany({
        where: { operationId: resolved.operation.id },
        include: includeUsersAndFields,
        orderBy: { seqNo: "asc" },
      });

      const maxSeq = items.length > 0 ? items[items.length - 1].seqNo : 0;

      const user = request.erpUser;
      const base = stepBasePath(orderKey, revNo, seqNo);
      return {
        items: items.map((item) =>
          formatItem(orderKey, revNo, seqNo, resolved.rev.status, user, item),
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
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot add steps to a ${resolved.rev.status} revision`,
        );
      }

      const item = await erpDb.$transaction(async (erpTx) => {
        const maxSeq = await erpTx.step.findFirst({
          where: { operationId: resolved.operation.id },
          orderBy: { seqNo: "desc" },
          select: { seqNo: true },
        });
        const defaultSeqNo = calcNextSeqNo(maxSeq?.seqNo ?? 0);
        const nextSeqNo = requestedSeqNo ?? defaultSeqNo;

        return erpTx.step.create({
          data: {
            operationId: resolved.operation.id,
            seqNo: nextSeqNo,
            instructions: instructions ?? "",
            createdById: userId,
            updatedById: userId,
          },
          include: includeUsersAndFields,
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
        return notFound(reply, "Operation not found");
      }

      const item = await erpDb.step.findFirst({
        where: { operationId: resolved.operation.id, seqNo: stepSeqNo },
        include: includeUsersAndFields,
      });
      if (!item) {
        return notFound(reply, `Step ${stepSeqNo} not found`);
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
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot update steps on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.step.findFirst({
        where: { operationId: resolved.operation.id, seqNo: stepSeqNo },
      });
      if (!existing) {
        return notFound(reply, `Step ${stepSeqNo} not found`);
      }

      const item = await erpDb.step.update({
        where: { id: existing.id },
        data: {
          ...(instructions !== undefined ? { instructions } : {}),
          ...(newSeqNo !== undefined ? { seqNo: newSeqNo } : {}),
          updatedById: userId,
        },
        include: includeUsersAndFields,
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
        return notFound(reply, "Operation not found");
      }

      if (resolved.rev.status !== RevisionStatus.draft) {
        return conflict(
          reply,
          `Cannot delete steps on a ${resolved.rev.status} revision`,
        );
      }

      const existing = await erpDb.step.findFirst({
        where: { operationId: resolved.operation.id, seqNo: stepSeqNo },
      });
      if (!existing) {
        return notFound(reply, `Step ${stepSeqNo} not found`);
      }

      await erpDb.step.delete({ where: { id: existing.id } });
      reply.status(204);
    },
  });
}
