import type { HateoasAction } from "@naisys/common";
import {
  ErrorResponseSchema,
  FieldValueEntrySchema,
  OperationRunStatus,
  StepRunListResponseSchema,
  StepRunSchema,
  UpdateFieldValueSchema,
  UpdateStepRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission, requirePermission } from "../auth-middleware.js";
import { conflict, notFound, unprocessable } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  checkOpRunInProgress,
  checkOrderRunStarted,
  checkWorkCenterAccess,
  childItemLinks,
  formatAuditFields,
  resolveActions,
  resolveOpRun,
  resolveStepRun,
} from "../route-helpers.js";
import { ensureStepRunFieldRecord } from "../services/field-service.js";
import { isUserClockedIn } from "../services/labor-ticket-service.js";
import {
  deleteFieldValueSet,
  deserializeFieldValue,
  findStepRunWithField,
  getStepRun,
  listStepRuns,
  serializeFieldValue,
  type StepRunWithStep,
  updateStepRun,
  upsertFieldValue,
  validateCompletionFields,
  validateFieldValue,
} from "../services/step-run-service.js";

function stepRunResource(orderKey: string, runNo: number, seqNo: number) {
  return `orders/${orderKey}/runs/${runNo}/ops/${seqNo}/steps`;
}

function stepRunItemActions(
  orderKey: string,
  runNo: number,
  seqNo: number,
  stepSeqNo: number,
  opRunStatus: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  const href = `${API_PREFIX}/${stepRunResource(orderKey, runNo, seqNo)}/${stepSeqNo}`;

  return resolveActions(
    [
      {
        rel: "update",
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/schemas/UpdateStepRun`,
        permission: "order_executor",
        disabledWhen: (ctx) =>
          ctx.status !== OperationRunStatus.in_progress
            ? "Parent operation must be in progress"
            : null,
      },
    ],
    href,
    { status: opRunStatus, user },
  );
}

const OpSeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

const StepSeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
});

const FieldSeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
  fieldSeqNo: z.coerce.number().int(),
});

function formatStepRun(
  orderKey: string,
  runNo: number,
  seqNo: number,
  opRunStatus: string,
  user: ErpUser | undefined,
  stepRun: StepRunWithStep,
) {
  const canUpdate =
    hasPermission(user, "order_executor") &&
    opRunStatus === OperationRunStatus.in_progress;

  const stepSeqNo = stepRun.step.seqNo;
  const multiSet = stepRun.step.multiSet;
  const stepRunHref = `${API_PREFIX}/${stepRunResource(orderKey, runNo, seqNo)}/${stepSeqNo}`;

  // Determine how many sets exist
  const storedFieldValues = stepRun.fieldRecord?.fieldValues ?? [];
  const maxSetIndex = storedFieldValues.reduce(
    (max, fv) => Math.max(max, fv.setIndex),
    -1,
  );
  const setCount = Math.max(1, maxSetIndex + 1);

  // Merge field definitions with stored values + validation + attachments
  const fieldValues: {
    fieldId: number;
    fieldSeqNo: number;
    label: string;
    type: string;
    multiValue: boolean;
    required: boolean;
    setIndex: number;
    value: string | string[];
    attachments?: { id: number; filename: string; fileSize: number }[];
    validation: ReturnType<typeof validateFieldValue>;
  }[] = [];
  for (let si = 0; si < setCount; si++) {
    for (const field of stepRun.step.fieldSet?.fields ?? []) {
      const stored = storedFieldValues.find(
        (fv) => fv.fieldId === field.id && fv.setIndex === si,
      );
      const value = deserializeFieldValue(
        stored?.value ?? "",
        field.multiValue,
      );
      const attachments =
        field.type === "attachment" && stored
          ? stored.fieldAttachments.map((sfa) => sfa.attachment)
          : undefined;
      fieldValues.push({
        fieldId: field.id,
        fieldSeqNo: field.seqNo,
        label: field.label,
        type: field.type,
        multiValue: field.multiValue,
        required: field.required,
        setIndex: si,
        value,
        attachments,
        validation: validateFieldValue(
          field.type,
          field.multiValue,
          field.required,
          value,
        ),
      });
    }
  }

  const hasAttachmentFields = (stepRun.step.fieldSet?.fields ?? []).some(
    (f) => f.type === "attachment",
  );

  // Action templates — one per action type instead of per-field/set
  const actionTemplates = canUpdate
    ? [
        {
          rel: "updateField",
          hrefTemplate: `${stepRunHref}/fields/{fieldSeqNo}`,
          method: "PUT" as const,
          title: "Update Field Value",
          schema: `${API_PREFIX}/schemas/UpdateFieldValue`,
        },
        {
          rel: "deleteSet",
          hrefTemplate: `${stepRunHref}/sets/{setIndex}`,
          method: "DELETE" as const,
          title: "Delete Set",
        },
        ...(hasAttachmentFields
          ? [
              {
                rel: "uploadAttachment",
                hrefTemplate: `${stepRunHref}/fields/{fieldSeqNo}/attachments`,
                method: "POST" as const,
                title: "Upload Attachment",
                alternateEncoding: {
                  contentType: "multipart/form-data",
                  description:
                    "Upload file as multipart with field 'file' and optional 'setIndex'",
                  fileFields: ["file"],
                },
              },
            ]
          : []),
      ]
    : [];

  return {
    id: stepRun.id,
    operationRunId: stepRun.operationRunId,
    stepId: stepRun.stepId,
    seqNo: stepSeqNo,
    title: stepRun.step.title,
    instructions: stepRun.step.instructions,
    multiSet,
    completed: stepRun.completed,
    completionNote: stepRun.completionNote ?? null,
    fieldValues,
    ...formatAuditFields(stepRun),
    _links: childItemLinks(
      "/" + stepRunResource(orderKey, runNo, seqNo),
      stepSeqNo,
      "Step Runs",
      "/orders/" + orderKey + "/runs/" + runNo + "/ops/" + seqNo,
      "Operation Run",
      "StepRun",
      "operationRun",
    ),
    _actions: stepRunItemActions(
      orderKey,
      runNo,
      seqNo,
      stepSeqNo,
      opRunStatus,
      user,
    ),
    _actionTemplates: actionTemplates,
  };
}

export default function stepRunRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List step runs for an operation run",
      tags: ["Step Runs"],
      params: OpSeqNoParamsSchema,
      response: {
        200: StepRunListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) {
        return notFound(reply, `Operation run not found`);
      }

      const items = await listStepRuns(resolved.opRun.id);

      return {
        items: items.map((stepRun) =>
          formatStepRun(
            orderKey,
            runNo,
            seqNo,
            resolved.opRun.status,
            request.erpUser,
            stepRun,
          ),
        ),
        total: items.length,
        _links: [selfLink(`/${stepRunResource(orderKey, runNo, seqNo)}`)],
      };
    },
  });

  // GET by stepSeqNo
  app.get("/:stepSeqNo", {
    schema: {
      description: "Get a single step run by step sequence number",
      tags: ["Step Runs"],
      params: StepSeqNoParamsSchema,
      response: {
        200: StepRunSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo, stepSeqNo } = request.params;

      const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, `Step run not found`);
      }

      const stepRun = await getStepRun(resolved.stepRun.id);
      if (!stepRun) {
        return notFound(reply, `Step run not found`);
      }

      return formatStepRun(
        orderKey,
        runNo,
        seqNo,
        resolved.opRun.status,
        request.erpUser,
        stepRun,
      );
    },
  });

  // UPDATE — batch update completed flag + field values
  app.put("/:stepSeqNo", {
    schema: {
      description:
        "Update a step run — set completed and/or field values (operation run must be in_progress)",
      tags: ["Step Runs"],
      params: StepSeqNoParamsSchema,
      body: UpdateStepRunSchema,
      response: {
        200: StepRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo, stepSeqNo } = request.params;
      const { completed, completionNote, fieldValues } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, `Step run not found`);
      }

      const wcErr = await checkWorkCenterAccess(resolved.opRun.operationId, request.erpUser!);
      if (wcErr) return conflict(reply, wcErr);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      // Reopening a step doesn't require being clocked in
      if (completed !== false) {
        const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
        if (!clockedIn)
          return conflict(reply, `You must be clocked in to update steps`);
      }

      const existing = await getStepRun(resolved.stepRun.id);
      if (!existing) return notFound(reply, `Step run not found`);

      // Block field updates on a completed step unless also reopening
      if (existing.completed && completed !== false && fieldValues?.length) {
        return conflict(reply, `Cannot update fields: step run is completed`);
      }

      // When completing, validate all field values
      if (completed === true) {
        const completionErr = validateCompletionFields(existing, fieldValues);
        if (completionErr) return unprocessable(reply, completionErr);
      }

      const stepRun = await updateStepRun(
        resolved.stepRun.id,
        completed,
        completionNote,
        fieldValues,
        userId,
      );

      return formatStepRun(
        orderKey,
        runNo,
        seqNo,
        resolved.opRun.status,
        request.erpUser,
        stepRun,
      );
    },
  });

  // UPDATE single field value
  app.put("/:stepSeqNo/fields/:fieldSeqNo", {
    schema: {
      description:
        "Update a single field value on a step run (operation run must be in_progress)",
      tags: ["Step Runs"],
      params: FieldSeqNoParamsSchema,
      body: UpdateFieldValueSchema,
      response: {
        200: FieldValueEntrySchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo, stepSeqNo, fieldSeqNo } = request.params;
      const { value, setIndex } = request.body;
      const si = setIndex ?? 0;
      const userId = request.erpUser!.id;

      const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, `Step run not found`);
      }

      const wcErr = await checkWorkCenterAccess(resolved.opRun.operationId, request.erpUser!);
      if (wcErr) return conflict(reply, wcErr);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
      if (!clockedIn)
        return conflict(reply, `You must be clocked in to update field values`);

      const stepRun = await findStepRunWithField(
        resolved.stepRun.id,
        resolved.opRun.id,
        fieldSeqNo,
      );
      if (!stepRun) return notFound(reply, `Step run not found`);

      if (stepRun.completed) {
        return conflict(reply, `Cannot update field: step run is completed`);
      }

      const field = stepRun.step.fieldSet?.fields[0];
      if (!field) {
        return notFound(reply, `Step field not found`);
      }

      // Reject setIndex > 0 on non-multiSet steps
      if (si > 0 && !stepRun.step.multiSet) {
        return unprocessable(
          reply,
          `setIndex > 0 is only allowed on multi-set steps. For multi-value fields, pass an array of strings instead.`,
        );
      }

      const fieldRecordId = await ensureStepRunFieldRecord(
        resolved.stepRun.id,
        userId,
      );
      if (!fieldRecordId) return notFound(reply, "Step has no field set");

      await upsertFieldValue(fieldRecordId, field.id, si, value, userId);

      // Return deserialized value
      const responseValue = deserializeFieldValue(
        serializeFieldValue(value),
        field.multiValue,
      );

      return {
        fieldId: field.id,
        fieldSeqNo: field.seqNo,
        label: field.label,
        type: field.type,
        multiValue: field.multiValue,
        required: field.required,
        setIndex: si,
        value: responseValue,
        validation: validateFieldValue(
          field.type,
          field.multiValue,
          field.required,
          responseValue,
        ),
      };
    },
  });

  // DELETE a field value set
  const SetIndexParamsSchema = z.object({
    orderKey: z.string(),
    runNo: z.coerce.number().int(),
    seqNo: z.coerce.number().int(),
    stepSeqNo: z.coerce.number().int(),
    setIndex: z.coerce.number().int(),
  });

  app.delete("/:stepSeqNo/sets/:setIndex", {
    schema: {
      description:
        "Delete all field values for a set and re-index remaining sets",
      tags: ["Step Runs"],
      params: SetIndexParamsSchema,
      response: {
        200: StepRunSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo, stepSeqNo, setIndex } = request.params;
      const userId = request.erpUser!.id;

      const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
      if (!resolved) {
        return notFound(reply, `Step run not found`);
      }

      const wcErr = await checkWorkCenterAccess(resolved.opRun.operationId, request.erpUser!);
      if (wcErr) return conflict(reply, wcErr);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
      if (!clockedIn)
        return conflict(reply, `You must be clocked in to delete sets`);

      const existing = await getStepRun(resolved.stepRun.id);
      if (!existing) return notFound(reply, `Step run not found`);

      if (existing.completed) {
        return conflict(reply, `Cannot delete set: step run is completed`);
      }

      if (!existing.fieldRecord) {
        return notFound(reply, "No field values to delete");
      }
      await deleteFieldValueSet(existing.fieldRecord.id, setIndex);

      const stepRun = await getStepRun(resolved.stepRun.id);
      if (!stepRun) return notFound(reply, `Step run not found`);

      return formatStepRun(
        orderKey,
        runNo,
        seqNo,
        resolved.opRun.status,
        request.erpUser,
        stepRun,
      );
    },
  });
}
