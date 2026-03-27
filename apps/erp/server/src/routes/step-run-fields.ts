import {
  BatchFieldValueMutateResponseSchema,
  BatchFieldValueUpdateResponseSchema,
  BatchUpdateFieldValuesSchema,
  DeleteSetMutateResponseSchema,
  ErrorResponseSchema,
  FieldValueMutateResponseSchema,
  fieldTypeString,
  getValueFormatHint,
  UpdateFieldValueSchema,
} from "@naisys-erp/shared";
import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { requirePermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { conflict, notFound, unprocessable } from "../error-handler.js";
import {
  checkOpRunInProgress,
  checkOrderRunStarted,
  checkWorkCenterAccess,
  mutationResult,
  resolveStepRun,
} from "../route-helpers.js";
import { ensureStepRunFieldRecord } from "../services/field-service.js";
import {
  checkFieldValueShape,
  clearAttachmentFieldValue,
  deleteFieldValueSet,
  deserializeFieldValue,
  findStepRunWithField,
  serializeFieldValue,
  upsertFieldValue,
  validateFieldValue,
} from "../services/field-value-service.js";
import { isUserClockedIn } from "../services/labor-ticket-service.js";
import { getStepRunWithFields } from "../services/step-run-service.js";
import { computeStepRunHateoas, stepRunResource } from "./step-runs.js";
import { API_PREFIX } from "../hateoas.js";

const FieldSeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
  fieldSeqNo: z.coerce.number().int(),
});

const SetFieldSeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
  setIndex: z.coerce.number().int().min(0),
  fieldSeqNo: z.coerce.number().int(),
});

const StepSeqNoParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
});

const SetIndexParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
  stepSeqNo: z.coerce.number().int(),
  setIndex: z.coerce.number().int(),
});

export default function stepRunFieldRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Shared handler for updating a single field value
  async function handleFieldUpdate(request: any, reply: any, setIndex: number) {
    const { orderKey, runNo, seqNo, stepSeqNo, fieldSeqNo } = request.params;
    const { value } = request.body;
    const userId = request.erpUser!.id;

    const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
    if (!resolved) {
      return notFound(reply, `Step run not found`);
    }

    const wcErr = await checkWorkCenterAccess(
      resolved.opRun.operationId,
      request.erpUser!,
    );
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

    const shapeErr = checkFieldValueShape(field.label, field.type, field.isArray, value);
    if (shapeErr) return unprocessable(reply, shapeErr);

    // Reject setIndex > 0 on non-multiSet steps
    if (setIndex > 0 && !stepRun.step.multiSet) {
      return unprocessable(
        reply,
        `setIndex > 0 is only allowed on multi-set steps. For multi-value fields, pass an array of strings instead.`,
      );
    }

    // Block explicit value setting for attachment fields (managed by uploads)
    if (field.type === "attachment") {
      const isEmpty = Array.isArray(value)
        ? value.every((v) => !v.trim())
        : !value.trim();
      if (!isEmpty) {
        return reply.code(400).send({
          statusCode: 400,
          error: "Bad Request",
          message:
            "Attachment field values are managed by file uploads. " +
            "Use the upload endpoint to add files, or set an empty value to clear.",
        });
      }
    }

    const fieldRecordId = await ensureStepRunFieldRecord(
      resolved.stepRun.id,
      userId,
    );
    if (!fieldRecordId) return notFound(reply, "Step has no field set");

    if (field.type === "attachment") {
      await clearAttachmentFieldValue(
        fieldRecordId,
        field.id,
        setIndex,
        userId,
      );
    } else {
      await upsertFieldValue(fieldRecordId, field.id, setIndex, value, userId);
    }

    // Return deserialized value + updated step-level actions
    const responseValue =
      field.type === "attachment"
        ? field.isArray
          ? []
          : ""
        : deserializeFieldValue(serializeFieldValue(value), field.isArray);

    // Check ALL fields in the fieldSet (not just the filtered single field)
    // so that _actionTemplates include the right hints
    const [attachmentCount, arrayCount] = await Promise.all([
      erpDb.field.count({ where: { fieldSetId: field.fieldSetId, type: "attachment" } }),
      erpDb.field.count({ where: { fieldSetId: field.fieldSetId, isArray: true } }),
    ]);

    const hateoas = await computeStepRunHateoas(
      orderKey,
      runNo,
      seqNo,
      stepSeqNo,
      resolved.opRun.id,
      resolved.opRun.operationId,
      resolved.opRun.status,
      stepRun.completed,
      resolved.stepRun.id,
      stepRun.step.multiSet,
      attachmentCount > 0,
      arrayCount > 0,
      request.erpUser,
    );

    const validation = validateFieldValue(
      field.type,
      field.isArray,
      field.required,
      responseValue,
    );

    const fieldType = fieldTypeString(field.type, field.isArray);
    const full = {
      fieldId: field.id,
      fieldSeqNo: field.seqNo,
      label: field.label,
      type: fieldType,
      valueFormat: getValueFormatHint(fieldType),
      required: field.required,
      setIndex,
      value: responseValue,
      validation,
      ...hateoas,
    };

    return mutationResult(request, reply, full, {
      value: responseValue,
      validation,
      _actions: hateoas._actions,
    });
  }

  // UPDATE single field value (non-multiSet shorthand — implicit set 0)
  app.put("/:stepSeqNo/fields/:fieldSeqNo", {
    schema: {
      description:
        "Update a single field value on a step run (implicit set 0). " +
        "For multi-set steps, use /sets/{setIndex}/fields/{fieldSeqNo} instead.",
      tags: ["Step Runs"],
      params: FieldSeqNoParamsSchema,
      body: UpdateFieldValueSchema,
      response: {
        200: FieldValueMutateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => handleFieldUpdate(request, reply, 0),
  });

  // UPDATE single field value (explicit set index for multi-set steps)
  app.put("/:stepSeqNo/sets/:setIndex/fields/:fieldSeqNo", {
    schema: {
      description:
        "Update a single field value on a specific set of a multi-set step run",
      tags: ["Step Runs"],
      params: SetFieldSeqNoParamsSchema,
      body: UpdateFieldValueSchema,
      response: {
        200: FieldValueMutateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) =>
      handleFieldUpdate(request, reply, request.params.setIndex),
  });

  // Shared handler for batch updating field values
  async function handleBatchFieldUpdate(
    request: any,
    reply: any,
    setIndex: number,
  ) {
    const { orderKey, runNo, seqNo, stepSeqNo } = request.params;
    const { fieldValues } = request.body;
    const userId = request.erpUser!.id;

    const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
    if (!resolved) {
      return notFound(reply, `Step run not found`);
    }

    const wcErr = await checkWorkCenterAccess(
      resolved.opRun.operationId,
      request.erpUser!,
    );
    if (wcErr) return conflict(reply, wcErr);

    const orderErr = checkOrderRunStarted(resolved.run.status);
    if (orderErr) return conflict(reply, orderErr);

    const opErr = checkOpRunInProgress(resolved.opRun.status);
    if (opErr) return conflict(reply, opErr);

    const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
    if (!clockedIn)
      return conflict(reply, `You must be clocked in to update field values`);

    const existing = await getStepRunWithFields(resolved.stepRun.id);
    if (!existing) return notFound(reply, `Step run not found`);

    if (existing.completed) {
      return conflict(reply, `Cannot update fields: step run is completed`);
    }

    // Reject setIndex > 0 on non-multiSet steps
    if (setIndex > 0 && !existing.step.multiSet) {
      return unprocessable(
        reply,
        `setIndex > 0 is only allowed on multi-set steps`,
      );
    }

    // Build a map of fieldSeqNo -> field definition
    const fieldDefs = new Map(
      (existing.step.fieldSet?.fields ?? []).map((f) => [f.seqNo, f]),
    );

    // Validate all fieldSeqNos exist, block attachments, enforce array shape
    for (const item of fieldValues) {
      if (!fieldDefs.has(item.fieldSeqNo)) {
        return notFound(reply, `Step field ${item.fieldSeqNo} not found`);
      }
      const def = fieldDefs.get(item.fieldSeqNo)!;
      if (def.type === "attachment") {
        return reply.code(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: `Field "${def.label}" is an attachment field. Attachment values are managed by file uploads, not batch updates.`,
        });
      }
      const shapeErr = checkFieldValueShape(def.label, def.type, def.isArray, item.value);
      if (shapeErr) return unprocessable(reply, shapeErr);
    }

    const fieldRecordId = await ensureStepRunFieldRecord(
      resolved.stepRun.id,
      userId,
    );
    if (!fieldRecordId) return notFound(reply, "Step has no field set");

    // Upsert all field values
    const results = [];
    for (const item of fieldValues) {
      const field = fieldDefs.get(item.fieldSeqNo)!;
      await upsertFieldValue(
        fieldRecordId,
        field.id,
        setIndex,
        item.value,
        userId,
      );

      const responseValue = deserializeFieldValue(
        serializeFieldValue(item.value),
        field.isArray,
      );
      const fieldType = fieldTypeString(field.type, field.isArray);
      results.push({
        fieldId: field.id,
        fieldSeqNo: field.seqNo,
        label: field.label,
        type: fieldType,
        valueFormat: getValueFormatHint(fieldType),
        required: field.required,
        setIndex,
        value: responseValue,
        validation: validateFieldValue(
          field.type,
          field.isArray,
          field.required,
          responseValue,
        ),
      });
    }

    const allFields = existing.step.fieldSet?.fields ?? [];
    const hasAttachmentFields = allFields.some((f) => f.type === "attachment");
    const hasArrayFields = allFields.some((f) => f.isArray);

    const hateoas = await computeStepRunHateoas(
      orderKey,
      runNo,
      seqNo,
      stepSeqNo,
      resolved.opRun.id,
      resolved.opRun.operationId,
      resolved.opRun.status,
      existing.completed,
      resolved.stepRun.id,
      existing.step.multiSet,
      hasAttachmentFields,
      hasArrayFields,
      request.erpUser,
    );

    const full = { items: results, total: results.length, ...hateoas };

    return mutationResult(request, reply, full, {
      items: results.map((r) => ({
        fieldSeqNo: r.fieldSeqNo,
        value: r.value,
        validation: r.validation,
      })),
      total: results.length,
      _actions: hateoas._actions,
    });
  }

  // Shared handler for batch reading field values
  async function handleBatchFieldGet(
    request: any,
    reply: any,
    setIndex?: number,
  ) {
    const { orderKey, runNo, seqNo, stepSeqNo } = request.params;

    const resolved = await resolveStepRun(orderKey, runNo, seqNo, stepSeqNo);
    if (!resolved) {
      return notFound(reply, `Step run not found`);
    }

    const existing = await getStepRunWithFields(resolved.stepRun.id);
    if (!existing) return notFound(reply, `Step run not found`);

    const storedFieldValues = existing.fieldRecord?.fieldValues ?? [];
    const maxSetIndex = storedFieldValues.reduce(
      (max, fv) => Math.max(max, fv.setIndex),
      -1,
    );
    const totalSets = Math.max(1, maxSetIndex + 1);

    const startSet = setIndex ?? 0;
    const endSet = setIndex !== undefined ? setIndex + 1 : totalSets;

    const stepRunHref = `${API_PREFIX}/${stepRunResource(orderKey, runNo, seqNo)}/${stepSeqNo}`;
    const isMultiSet = existing.step.multiSet;
    const items = [];
    for (let si = startSet; si < endSet; si++) {
      for (const field of existing.step.fieldSet?.fields ?? []) {
        const stored = storedFieldValues.find(
          (fv) => fv.fieldId === field.id && fv.setIndex === si,
        );
        const value = deserializeFieldValue(
          stored?.value ?? "",
          field.isArray,
        );
        const setPath = isMultiSet
          ? `/sets/${si}/fields/${field.seqNo}`
          : `/fields/${field.seqNo}`;
        const attachments =
          field.type === "attachment" && stored
            ? stored.fieldAttachments.map((sfa) => ({
                ...sfa.attachment,
                downloadHref: `${stepRunHref}${setPath}/attachments/${sfa.attachment.id}`,
              }))
            : undefined;
        const fieldType = fieldTypeString(field.type, field.isArray);
        items.push({
          fieldId: field.id,
          fieldSeqNo: field.seqNo,
          label: field.label,
          type: fieldType,
          valueFormat: getValueFormatHint(fieldType),
          required: field.required,
          setIndex: si,
          value,
          attachments,
          validation: validateFieldValue(
            field.type,
            field.isArray,
            field.required,
            value,
          ),
        });
      }
    }

    const allFields2 = existing.step.fieldSet?.fields ?? [];
    const hasAttachmentFields = allFields2.some((f) => f.type === "attachment");
    const hasArrayFields = allFields2.some((f) => f.isArray);

    const hateoas = await computeStepRunHateoas(
      orderKey,
      runNo,
      seqNo,
      stepSeqNo,
      resolved.opRun.id,
      resolved.opRun.operationId,
      resolved.opRun.status,
      existing.completed,
      resolved.stepRun.id,
      existing.step.multiSet,
      hasAttachmentFields,
      hasArrayFields,
      request.erpUser,
    );

    return { items, total: items.length, ...hateoas };
  }

  // BATCH GET field values (non-multiSet shorthand — all sets)
  app.get("/:stepSeqNo/fields", {
    schema: {
      description:
        "Get all field values on a step run. " +
        "For multi-set steps, use /sets/{setIndex}/fields to get a specific set.",
      tags: ["Step Runs"],
      params: StepSeqNoParamsSchema,
      response: {
        200: BatchFieldValueUpdateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => handleBatchFieldGet(request, reply),
  });

  // BATCH GET field values (explicit set index for multi-set steps)
  app.get("/:stepSeqNo/sets/:setIndex/fields", {
    schema: {
      description:
        "Get field values for a specific set of a multi-set step run",
      tags: ["Step Runs"],
      params: SetFieldSeqNoParamsSchema.omit({ fieldSeqNo: true }),
      response: {
        200: BatchFieldValueUpdateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) =>
      handleBatchFieldGet(request, reply, request.params.setIndex),
  });

  // BATCH UPDATE field values (non-multiSet shorthand — implicit set 0)
  app.put("/:stepSeqNo/fields", {
    schema: {
      description:
        "Batch update field values on a step run (implicit set 0). " +
        "For multi-set steps, use /sets/{setIndex}/fields instead.",
      tags: ["Step Runs"],
      params: StepSeqNoParamsSchema,
      body: BatchUpdateFieldValuesSchema,
      response: {
        200: BatchFieldValueMutateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) =>
      handleBatchFieldUpdate(request, reply, 0),
  });

  // BATCH UPDATE field values (explicit set index for multi-set steps)
  app.put("/:stepSeqNo/sets/:setIndex/fields", {
    schema: {
      description:
        "Batch update field values on a specific set of a multi-set step run",
      tags: ["Step Runs"],
      params: SetFieldSeqNoParamsSchema.omit({ fieldSeqNo: true }),
      body: BatchUpdateFieldValuesSchema,
      response: {
        200: BatchFieldValueMutateResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        422: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) =>
      handleBatchFieldUpdate(request, reply, request.params.setIndex),
  });

  // DELETE a field value set
  app.delete("/:stepSeqNo/sets/:setIndex", {
    schema: {
      description:
        "Delete all field values for a set and re-index remaining sets",
      tags: ["Step Runs"],
      params: SetIndexParamsSchema,
      response: {
        200: DeleteSetMutateResponseSchema,
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

      const wcErr = await checkWorkCenterAccess(
        resolved.opRun.operationId,
        request.erpUser!,
      );
      if (wcErr) return conflict(reply, wcErr);

      const orderErr = checkOrderRunStarted(resolved.run.status);
      if (orderErr) return conflict(reply, orderErr);

      const opErr = checkOpRunInProgress(resolved.opRun.status);
      if (opErr) return conflict(reply, opErr);

      const clockedIn = await isUserClockedIn(resolved.opRun.id, userId);
      if (!clockedIn)
        return conflict(reply, `You must be clocked in to delete sets`);

      const existing = await getStepRunWithFields(resolved.stepRun.id);
      if (!existing) return notFound(reply, `Step run not found`);

      if (existing.completed) {
        return conflict(reply, `Cannot delete set: step run is completed`);
      }

      if (!existing.fieldRecord) {
        return notFound(reply, "No field values to delete");
      }
      await deleteFieldValueSet(existing.fieldRecord.id, setIndex);

      // Compute new set count from remaining field values
      const updated = await getStepRunWithFields(resolved.stepRun.id);
      const storedFieldValues = updated?.fieldRecord?.fieldValues ?? [];
      const maxSetIndex = storedFieldValues.reduce(
        (max, fv) => Math.max(max, fv.setIndex),
        -1,
      );
      const setCount = Math.max(1, maxSetIndex + 1);

      const delFields = existing.step.fieldSet?.fields ?? [];
      const hasAttachmentFields = delFields.some((f) => f.type === "attachment");
      const hasArrayFields = delFields.some((f) => f.isArray);

      const hateoas = await computeStepRunHateoas(
        orderKey,
        runNo,
        seqNo,
        stepSeqNo,
        resolved.opRun.id,
        resolved.opRun.operationId,
        resolved.opRun.status,
        existing.completed,
        resolved.stepRun.id,
        existing.step.multiSet,
        hasAttachmentFields,
        hasArrayFields,
        request.erpUser,
      );

      const full = { setCount, ...hateoas };

      return mutationResult(request, reply, full, {
        setCount,
        _actions: hateoas._actions,
      });
    },
  });
}
