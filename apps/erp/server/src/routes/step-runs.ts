import type { HateoasAction } from "@naisys/common";
import {
  ErrorResponseSchema,
  OperationRunStatus,
  StepFieldType,
  type StepFieldValidation,
  StepFieldValueSchema,
  StepRunListResponseSchema,
  StepRunSchema,
  UpdateStepFieldValueSchema,
  UpdateStepRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { conflict, notFound, unprocessable } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  childItemLinks,
  formatAuditFields,
  resolveOpRun,
} from "../route-helpers.js";

function stepRunResource(orderKey: string, runId: number, opRunId: number) {
  return `orders/${orderKey}/runs/${runId}/ops/${opRunId}/steps`;
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

const FieldValueParamsSchema = z.object({
  orderKey: z.string(),
  runId: z.coerce.number().int(),
  opRunId: z.coerce.number().int(),
  id: z.coerce.number().int(),
  stepFieldId: z.coerce.number().int(),
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

function validateFieldValue(
  type: string,
  required: boolean,
  value: string,
): StepFieldValidation {
  if (required && !value.trim()) {
    return { valid: false, error: "Required" };
  }
  if (value.trim() && type === StepFieldType.number) {
    if (isNaN(Number(value))) {
      return { valid: false, error: "Must be a number" };
    }
  }
  return { valid: true };
}

function formatItem(
  orderKey: string,
  runId: number,
  opRunId: number,
  opRunStatus: string,
  user: ErpUser | undefined,
  item: StepRunWithStep,
) {
  const canUpdate =
    hasPermission(user, "manage_runs") &&
    opRunStatus === OperationRunStatus.in_progress;

  const stepRunHref = `${API_PREFIX}/${stepRunResource(orderKey, runId, opRunId)}/${item.id}`;

  // Merge field definitions with stored values + validation + actions
  const fieldValues = item.step.fields.map((field) => {
    const stored = item.fieldValues.find((fv) => fv.stepFieldId === field.id);
    const value = stored?.value ?? "";
    return {
      stepFieldId: field.id,
      label: field.label,
      type: field.type,
      required: field.required,
      value,
      validation: validateFieldValue(field.type, field.required, value),
      _actions: canUpdate
        ? [
            {
              rel: "update" as const,
              href: `${stepRunHref}/fields/${field.id}`,
              method: "PUT" as const,
              title: "Update Field Value",
              schema: `${API_PREFIX}/schemas/UpdateStepFieldValue`,
            },
          ]
        : [],
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
    ...formatAuditFields(item),
    _links: childItemLinks(
      "/" + stepRunResource(orderKey, runId, opRunId),
      item.id,
      "Step Runs",
      "/orders/" + orderKey + "/runs/" + runId + "/ops/" + opRunId,
      "Operation Run",
      "StepRun",
      "operationRun",
    ),
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
        return notFound(reply, `Operation run not found`);
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
        return notFound(reply, `Operation run not found`);
      }

      const item = await erpDb.stepRun.findUnique({
        where: { id },
        include: includeStep,
      });
      if (!item || item.operationRunId !== opRunId) {
        return notFound(reply, `Step run ${id} not found`);
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
        422: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, opRunId, id } = request.params;
      const { completed, fieldValues } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runId, opRunId);
      if (!resolved) {
        return notFound(reply, `Operation run not found`);
      }

      if (resolved.opRun.status !== OperationRunStatus.in_progress) {
        return conflict(
          reply,
          `Cannot update step run when operation run is ${resolved.opRun.status}`,
        );
      }

      const existing = await erpDb.stepRun.findUnique({
        where: { id },
        include: includeStep,
      });
      if (!existing || existing.operationRunId !== opRunId) {
        return notFound(reply, `Step run ${id} not found`);
      }

      // When completing, validate all field values
      if (completed === true) {
        // Build the effective values map (submitted values override stored)
        const submittedMap = new Map(
          (fieldValues ?? []).map((fv) => [fv.stepFieldId, fv.value]),
        );
        const storedMap = new Map(
          existing.fieldValues.map((fv) => [fv.stepFieldId, fv.value]),
        );

        const errors: string[] = [];
        for (const field of existing.step.fields) {
          const value =
            submittedMap.get(field.id) ?? storedMap.get(field.id) ?? "";
          const result = validateFieldValue(field.type, field.required, value);
          if (!result.valid) {
            errors.push(`${field.label}: ${result.error}`);
          }
        }

        if (errors.length > 0) {
          return unprocessable(
            reply,
            `Cannot complete step: ${errors.join(", ")}`,
          );
        }
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

  // UPDATE single field value
  app.put("/:id/fields/:stepFieldId", {
    schema: {
      description:
        "Update a single field value on a step run (operation run must be in_progress)",
      tags: ["Step Runs"],
      params: FieldValueParamsSchema,
      body: UpdateStepFieldValueSchema,
      response: {
        200: StepFieldValueSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runId, opRunId, id, stepFieldId } = request.params;
      const { value } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runId, opRunId);
      if (!resolved) {
        return notFound(reply, `Operation run not found`);
      }

      if (resolved.opRun.status !== OperationRunStatus.in_progress) {
        return conflict(
          reply,
          `Cannot update field when operation run is ${resolved.opRun.status}`,
        );
      }

      const stepRun = await erpDb.stepRun.findUnique({
        where: { id },
        include: {
          step: {
            select: {
              fields: {
                where: { id: stepFieldId },
                select: { id: true, label: true, type: true, required: true },
              },
            },
          },
        },
      });
      if (!stepRun || stepRun.operationRunId !== opRunId) {
        return notFound(reply, `Step run ${id} not found`);
      }

      const field = stepRun.step.fields[0];
      if (!field) {
        return notFound(reply, `Step field ${stepFieldId} not found`);
      }

      await erpDb.stepFieldValue.upsert({
        where: {
          stepRunId_stepFieldId: { stepRunId: id, stepFieldId },
        },
        create: {
          stepRunId: id,
          stepFieldId,
          value,
          createdById: userId,
          updatedById: userId,
        },
        update: {
          value,
          updatedById: userId,
        },
      });

      const stepRunHref = `${API_PREFIX}/${stepRunResource(orderKey, runId, opRunId)}/${id}`;
      return {
        stepFieldId: field.id,
        label: field.label,
        type: field.type,
        required: field.required,
        value,
        validation: validateFieldValue(field.type, field.required, value),
        _actions: [
          {
            rel: "update" as const,
            href: `${stepRunHref}/fields/${field.id}`,
            method: "PUT" as const,
            title: "Update Field Value",
            schema: `${API_PREFIX}/schemas/UpdateStepFieldValue`,
          },
        ],
      };
    },
  });
}
