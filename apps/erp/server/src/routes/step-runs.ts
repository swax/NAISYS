import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  ErrorResponseSchema,
  OperationRunStatus,
  StepRunListResponseSchema,
  StepRunSchema,
  UpdateStepRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import { API_PREFIX, schemaLink, selfLink } from "../hateoas.js";

function stepRunResource(orderKey: string, runId: number, opRunId: number) {
  return `orders/${orderKey}/runs/${runId}/ops/${opRunId}/steps`;
}

function stepRunItemLinks(
  orderKey: string,
  runId: number,
  opRunId: number,
  id: number,
): HateoasLink[] {
  const resource = stepRunResource(orderKey, runId, opRunId);
  return [
    selfLink(`/${resource}/${id}`),
    {
      rel: "collection",
      href: `${API_PREFIX}/${resource}`,
      title: "Step Runs",
    },
    {
      rel: "operationRun",
      href: `${API_PREFIX}/orders/${orderKey}/runs/${runId}/ops/${opRunId}`,
      title: "Operation Run",
    },
    schemaLink("StepRun"),
  ];
}

function stepRunItemActions(
  orderKey: string,
  runId: number,
  opRunId: number,
  id: number,
  opRunStatus: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (!hasPermission(user, "manage_runs")) return [];
  // Only allow updates when the parent operation run is in_progress
  if (opRunStatus !== OperationRunStatus.in_progress) return [];

  const href = `${API_PREFIX}/${stepRunResource(orderKey, runId, opRunId)}/${id}`;
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateStepRun`,
    },
  ];
}

const OpRunParamsSchema = z.object({
  orderKey: z.string(),
  runId: z.coerce.number().int(),
  opRunId: z.coerce.number().int(),
});

const IdParamsSchema = z.object({
  orderKey: z.string(),
  runId: z.coerce.number().int(),
  opRunId: z.coerce.number().int(),
  id: z.coerce.number().int(),
});

const includeStep = {
  step: {
    select: {
      seqNo: true,
      instructions: true,
      fields: {
        select: { id: true, label: true, type: true, required: true },
        orderBy: { seqNo: "asc" as const },
      },
    },
  },
  fieldValues: {
    select: { stepFieldId: true, value: true },
  },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

type StepRunWithStep = {
  id: number;
  operationRunId: number;
  stepId: number;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
  step: {
    seqNo: number;
    instructions: string;
    fields: { id: number; label: string; type: string; required: boolean }[];
  };
  fieldValues: { stepFieldId: number; value: string }[];
  createdBy: { username: string };
  updatedBy: { username: string };
};

function formatItem(
  orderKey: string,
  runId: number,
  opRunId: number,
  opRunStatus: string,
  user: ErpUser | undefined,
  item: StepRunWithStep,
) {
  // Merge field definitions with stored values
  const fieldValues = item.step.fields.map((field) => {
    const stored = item.fieldValues.find((fv) => fv.stepFieldId === field.id);
    return {
      stepFieldId: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
      value: stored?.value ?? "",
    };
  });

  return {
    id: item.id,
    operationRunId: item.operationRunId,
    stepId: item.stepId,
    seqNo: item.step.seqNo,
    instructions: item.step.instructions,
    completed: item.completed,
    fieldValues,
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy.username,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedBy.username,
    _links: stepRunItemLinks(orderKey, runId, opRunId, item.id),
    _actions: stepRunItemActions(
      orderKey,
      runId,
      opRunId,
      item.id,
      opRunStatus,
      user,
    ),
  };
}

async function resolveOpRun(orderKey: string, runId: number, opRunId: number) {
  const order = await erpDb.order.findUnique({ where: { key: orderKey } });
  if (!order) return null;

  const run = await erpDb.orderRun.findUnique({ where: { id: runId } });
  if (!run || run.orderId !== order.id) return null;

  const opRun = await erpDb.operationRun.findUnique({
    where: { id: opRunId },
  });
  if (!opRun || opRun.orderRunId !== runId) return null;

  return { order, run, opRun };
}

export default function stepRunRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List step runs for an operation run",
      tags: ["Step Runs"],
      params: OpRunParamsSchema,
      response: {
        200: StepRunListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, opRunId } = request.params;

      const resolved = await resolveOpRun(orderKey, runId, opRunId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Operation run not found`);
      }

      const items = await erpDb.stepRun.findMany({
        where: { operationRunId: opRunId },
        include: includeStep,
        orderBy: { step: { seqNo: "asc" } },
      });

      const resource = stepRunResource(orderKey, runId, opRunId);

      return {
        items: items.map((item) =>
          formatItem(
            orderKey,
            runId,
            opRunId,
            resolved.opRun.status,
            request.erpUser,
            item,
          ),
        ),
        total: items.length,
        _links: [selfLink(`/${resource}`)],
      };
    },
  });

  // GET by ID
  app.get("/:id", {
    schema: {
      description: "Get a single step run by ID",
      tags: ["Step Runs"],
      params: IdParamsSchema,
      response: {
        200: StepRunSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, opRunId, id } = request.params;

      const resolved = await resolveOpRun(orderKey, runId, opRunId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Operation run not found`);
      }

      const item = await erpDb.stepRun.findUnique({
        where: { id },
        include: includeStep,
      });
      if (!item || item.operationRunId !== opRunId) {
        return sendError(reply, 404, "Not Found", `Step run ${id} not found`);
      }

      return formatItem(
        orderKey,
        runId,
        opRunId,
        resolved.opRun.status,
        request.erpUser,
        item,
      );
    },
  });

  // UPDATE — batch update completed flag + field values
  app.put("/:id", {
    schema: {
      description:
        "Update a step run — set completed and/or field values (operation run must be in_progress)",
      tags: ["Step Runs"],
      params: IdParamsSchema,
      body: UpdateStepRunSchema,
      response: {
        200: StepRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, opRunId, id } = request.params;
      const { completed, fieldValues } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runId, opRunId);
      if (!resolved) {
        return sendError(reply, 404, "Not Found", `Operation run not found`);
      }

      if (resolved.opRun.status !== OperationRunStatus.in_progress) {
        return sendError(
          reply,
          409,
          "Conflict",
          `Cannot update step run when operation run is ${resolved.opRun.status}`,
        );
      }

      const existing = await erpDb.stepRun.findUnique({ where: { id } });
      if (!existing || existing.operationRunId !== opRunId) {
        return sendError(reply, 404, "Not Found", `Step run ${id} not found`);
      }

      const item = await erpDb.$transaction(async (erpTx) => {
        // Update completed flag
        if (completed !== undefined) {
          await erpTx.stepRun.update({
            where: { id },
            data: { completed, updatedById: userId },
          });
        }

        // Upsert field values
        if (fieldValues && fieldValues.length > 0) {
          for (const fv of fieldValues) {
            await erpTx.stepFieldValue.upsert({
              where: {
                stepRunId_stepFieldId: {
                  stepRunId: id,
                  stepFieldId: fv.stepFieldId,
                },
              },
              create: {
                stepRunId: id,
                stepFieldId: fv.stepFieldId,
                value: fv.value,
                createdById: userId,
                updatedById: userId,
              },
              update: {
                value: fv.value,
                updatedById: userId,
              },
            });
          }
        }

        return erpTx.stepRun.findUniqueOrThrow({
          where: { id },
          include: includeStep,
        });
      });

      return formatItem(
        orderKey,
        runId,
        opRunId,
        resolved.opRun.status,
        request.erpUser,
        item,
      );
    },
  });
}
