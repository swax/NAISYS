import type { HateoasAction } from "@naisys/common";
import {
  ErrorResponseSchema,
  OperationRunStatus,
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
import { conflict, notFound, unprocessable } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  checkOpRunInProgress,
  checkOrderRunStarted,
  childItemLinks,
  formatAuditFields,
  resolveOpRun,
} from "../route-helpers.js";
import {
  findExisting,
  findStepRunWithField,
  getStepRun,
  listStepRuns,
  type StepRunWithStep,
  updateStepRun,
  upsertFieldValue,
  validateCompletionFields,
  validateFieldValue,
} from "../services/step-run-service.js";

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

      const items = await listStepRuns(opRunId);

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
        _links: [selfLink(`/${stepRunResource(orderKey, runId, opRunId)}`)],
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

      const item = await getStepRun(id);
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

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      const existing = await findExisting(id, opRunId);
      if (!existing) return notFound(reply, `Step run ${id} not found`);

      // Block field updates on a completed step unless also reopening
      if (existing.completed && completed !== false && fieldValues?.length) {
        return conflict(reply, `Cannot update fields: step run is completed`);
      }

      // When completing, validate all field values
      if (completed === true) {
        const completionErr = validateCompletionFields(existing, fieldValues);
        if (completionErr) return unprocessable(reply, completionErr);
      }

      const item = await updateStepRun(id, completed, fieldValues, userId);

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

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      const stepRun = await findStepRunWithField(id, opRunId, stepFieldId);
      if (!stepRun) return notFound(reply, `Step run ${id} not found`);

      if (stepRun.completed) {
        return conflict(reply, `Cannot update field: step run is completed`);
      }

      const field = stepRun.step.fields[0];
      if (!field) {
        return notFound(reply, `Step field ${stepFieldId} not found`);
      }

      await upsertFieldValue(id, stepFieldId, value, userId);

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
