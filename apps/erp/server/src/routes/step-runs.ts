import type { HateoasAction } from "@naisys/common";
import {
  ErrorResponseSchema,
  getValueFormatHint,
  OperationRunStatus,
  StepRunListQuerySchema,
  StepRunListResponseSchema,
  StepRunSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import { notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
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
  getStepRunWithFields,
  listStepRuns,
  listStepRunsWithFields,
  type StepRunWithStep,
  type StepRunWithStepAndFields,
} from "../services/step-run-service.js";

export function stepRunResource(
  orderKey: string,
  runNo: number,
  seqNo: number,
) {
  return `orders/${orderKey}/runs/${runNo}/ops/${seqNo}/steps`;
}

async function stepRunItemActions(
  orderKey: string,
  runNo: number,
  seqNo: number,
  stepSeqNo: number,
  opRunId: number,
  operationId: number,
  opRunStatus: string,
  completed: boolean,
  stepRunId: number,
  user: ErpUser | undefined,
): Promise<HateoasAction[]> {
  const href = `${API_PREFIX}/${stepRunResource(orderKey, runNo, seqNo)}/${stepSeqNo}`;
  const isExecutor = hasPermission(user, "order_executor");
  const isInProgress = opRunStatus === OperationRunStatus.in_progress;

  // Pre-compute disabled reasons for complete action
  const wcErr = user
    ? await checkWorkCenterAccess(operationId, user)
    : null;
  const clockedInErr =
    isExecutor && isInProgress && !completed
      ? (await isUserClockedIn(opRunId, user!.id))
        ? null
        : "You must be clocked in to complete steps"
      : null;
  const fieldsErr =
    isExecutor && isInProgress && !completed
      ? await (async () => {
          const existing = await getStepRunWithFields(stepRunId);
          return existing ? validateCompletionFields(existing) : null;
        })()
      : null;

  return resolveActions(
    [
      {
        rel: "complete",
        path: "/complete",
        method: "POST",
        title: "Complete",
        schema: `${API_PREFIX}/schemas/CompleteStepRun`,
        permission: "order_executor",
        visibleWhen: () => !completed,
        disabledWhen: () =>
          !isInProgress
            ? "Parent operation must be in progress"
            : wcErr ?? clockedInErr ?? fieldsErr,
      },
      {
        rel: "reopen",
        path: "/reopen",
        method: "POST",
        title: "Reopen",
        permission: "order_executor",
        visibleWhen: () => completed,
        disabledWhen: () =>
          !isInProgress
            ? "Parent operation must be in progress"
            : wcErr,
      },
    ],
    href,
    { status: opRunStatus, user },
  );
}

export function buildStepRunActionTemplates(
  stepRunHref: string,
  canUpdate: boolean,
  multiSet: boolean,
  hasAttachmentFields: boolean,
) {
  if (!canUpdate) return [];
  return [
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
          {
            rel: "deleteAttachment",
            hrefTemplate: multiSet
              ? `${stepRunHref}/sets/{setIndex}/fields/{fieldSeqNo}/attachments/{attachmentId}`
              : `${stepRunHref}/fields/{fieldSeqNo}/attachments/{attachmentId}`,
            method: "DELETE" as const,
            title: "Delete Attachment",
          },
        ]
      : []),
  ];
}

/** Compute just the HATEOAS actions + action templates for a step run */
export async function computeStepRunHateoas(
  orderKey: string,
  runNo: number,
  seqNo: number,
  stepSeqNo: number,
  opRunId: number,
  operationId: number,
  opRunStatus: string,
  completed: boolean,
  stepRunId: number,
  multiSet: boolean,
  hasAttachmentFields: boolean,
  user: ErpUser | undefined,
) {
  const canUpdate =
    hasPermission(user, "order_executor") &&
    opRunStatus === OperationRunStatus.in_progress;
  const stepRunHref = `${API_PREFIX}/${stepRunResource(orderKey, runNo, seqNo)}/${stepSeqNo}`;

  return {
    _actions: await stepRunItemActions(
      orderKey,
      runNo,
      seqNo,
      stepSeqNo,
      opRunId,
      operationId,
      opRunStatus,
      completed,
      stepRunId,
      user,
    ),
    _actionTemplates: buildStepRunActionTemplates(
      stepRunHref,
      canUpdate,
      multiSet,
      hasAttachmentFields,
    ),
  };
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

export async function formatStepRunTransition(
  orderKey: string,
  runNo: number,
  seqNo: number,
  opRunId: number,
  operationId: number,
  opRunStatus: string,
  user: ErpUser | undefined,
  stepRun: StepRunWithStepAndFields,
) {
  const stepSeqNo = stepRun.step.seqNo;
  const multiSet = stepRun.step.multiSet;
  const hasAttachmentFields = (stepRun.step.fieldSet?.fields ?? []).some(
    (f) => f.type === "attachment",
  );

  const hateoas = await computeStepRunHateoas(
    orderKey,
    runNo,
    seqNo,
    stepSeqNo,
    opRunId,
    operationId,
    opRunStatus,
    stepRun.completed,
    stepRun.id,
    multiSet,
    hasAttachmentFields,
    user,
  );

  return {
    id: stepRun.id,
    completed: stepRun.completed,
    note: stepRun.statusNote ?? null,
    ...formatAuditFields(stepRun),
    ...hateoas,
  };
}

export async function formatStepRunWithFields(
  orderKey: string,
  runNo: number,
  seqNo: number,
  opRunId: number,
  operationId: number,
  opRunStatus: string,
  user: ErpUser | undefined,
  stepRun: StepRunWithStepAndFields,
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
    valueFormat: string;
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
        valueFormat: getValueFormatHint(field.type),
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

  const hateoas = await computeStepRunHateoas(
    orderKey,
    runNo,
    seqNo,
    stepSeqNo,
    opRunId,
    operationId,
    opRunStatus,
    stepRun.completed,
    stepRun.id,
    multiSet,
    hasAttachmentFields,
    user,
  );

  return {
    id: stepRun.id,
    operationRunId: stepRun.operationRunId,
    stepId: stepRun.stepId,
    seqNo: stepSeqNo,
    title: stepRun.step.title,
    instructions: stepRun.step.instructions,
    multiSet,
    completed: stepRun.completed,
    note: stepRun.statusNote ?? null,
    fieldCount: stepRun.step.fieldSet?.fields.length ?? 0,
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
    ...hateoas,
  };
}

function formatListStepRun(
  orderKey: string,
  runNo: number,
  seqNo: number,
  stepRun: StepRunWithStep,
) {
  const stepSeqNo = stepRun.step.seqNo;
  const fieldCount = stepRun.step.fieldSet?._count.fields ?? 0;

  return {
    id: stepRun.id,
    operationRunId: stepRun.operationRunId,
    stepId: stepRun.stepId,
    seqNo: stepSeqNo,
    title: stepRun.step.title,
    instructions: stepRun.step.instructions,
    multiSet: stepRun.step.multiSet,
    completed: stepRun.completed,
    note: stepRun.statusNote ?? null,
    fieldCount,
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
      querystring: StepRunListQuerySchema,
      response: {
        200: StepRunListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;
      const { includeFields } = request.query;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) {
        return notFound(reply, `Operation run not found`);
      }

      if (includeFields) {
        const items = await listStepRunsWithFields(resolved.opRun.id);
        return {
          items: await Promise.all(
            items.map((stepRun) =>
              formatStepRunWithFields(
                orderKey,
                runNo,
                seqNo,
                resolved.opRun.id,
                resolved.opRun.operationId,
                resolved.opRun.status,
                request.erpUser,
                stepRun,
              ),
            ),
          ),
          total: items.length,
          _links: [selfLink(`/${stepRunResource(orderKey, runNo, seqNo)}`)],
        };
      }

      const items = await listStepRuns(resolved.opRun.id);
      return {
        items: items.map((stepRun) =>
          formatListStepRun(orderKey, runNo, seqNo, stepRun),
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

      const stepRun = await getStepRunWithFields(resolved.stepRun.id);
      if (!stepRun) {
        return notFound(reply, `Step run not found`);
      }

      return formatStepRunWithFields(
        orderKey,
        runNo,
        seqNo,
        resolved.opRun.id,
        resolved.opRun.operationId,
        resolved.opRun.status,
        request.erpUser,
        stepRun,
      );
    },
  });
}
