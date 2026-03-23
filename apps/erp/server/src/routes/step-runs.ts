import type { HateoasAction } from "@naisys/common";
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
import {
  deserializeFieldValue,
  validateCompletionFields,
  validateFieldValue,
} from "../services/field-value-service.js";
import { isUserClockedIn } from "../services/labor-ticket-service.js";
import {
  getStepRun,
  listStepRuns,
  type StepRunWithStep,
  updateStepRun,
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

export function formatStepRun(
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
  // For multiSet steps, field URLs include /sets/{setIndex}/ so the AI agent
  // knows to specify which set row to update. For non-multiSet steps, the
  // simpler /fields/{fieldSeqNo} path is used (implicit set 0).
  const actionTemplates = canUpdate
    ? [
        {
          rel: "updateField",
          hrefTemplate: multiSet
            ? `${stepRunHref}/sets/{setIndex}/fields/{fieldSeqNo}`
            : `${stepRunHref}/fields/{fieldSeqNo}`,
          method: "PUT" as const,
          title: "Update Field Value",
          schema: `${API_PREFIX}/schemas/UpdateFieldValue`,
        },
        {
          rel: "batchUpdateFields",
          hrefTemplate: multiSet
            ? `${stepRunHref}/sets/{setIndex}/fields`
            : `${stepRunHref}/fields`,
          method: "PUT" as const,
          title: "Batch Update Field Values",
          schema: `${API_PREFIX}/schemas/BatchUpdateFieldValues`,
        },
        ...(multiSet
          ? [
              {
                rel: "deleteSet",
                hrefTemplate: `${stepRunHref}/sets/{setIndex}`,
                method: "DELETE" as const,
                title: "Delete Set",
              },
            ]
          : []),
        ...(hasAttachmentFields
          ? [
              {
                rel: "uploadAttachment",
                hrefTemplate: multiSet
                  ? `${stepRunHref}/sets/{setIndex}/fields/{fieldSeqNo}/attachments`
                  : `${stepRunHref}/fields/{fieldSeqNo}/attachments`,
                method: "POST" as const,
                title: "Upload Attachment",
                alternateEncoding: {
                  contentType: "multipart/form-data",
                  description:
                    "Upload file as multipart/form-data with field 'file'",
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

  // UPDATE — set completed flag and/or completion note
  app.put("/:stepSeqNo", {
    schema: {
      description:
        "Update a step run — set completed and/or completion note (operation run must be in_progress)",
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
      const { completed, completionNote } = request.body;
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

      // When completing, validate all stored field values
      if (completed === true) {
        const existing = await getStepRun(resolved.stepRun.id);
        if (!existing) return notFound(reply, `Step run not found`);

        const completionErr = validateCompletionFields(existing);
        if (completionErr) return unprocessable(reply, completionErr);
      }

      const stepRun = await updateStepRun(
        resolved.stepRun.id,
        completed,
        completionNote,
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
}
