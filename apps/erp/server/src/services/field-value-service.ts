import { formatFileSize } from "@naisys/common";
import {
  FieldType,
  type FieldValidation,
  type FieldValue,
} from "@naisys-erp/shared";

import erpDb from "../erpDb.js";
import type { StepRunWithStepAndFields } from "./step-run-service.js";

// --- Lookups ---

export async function findStepRunWithField(
  id: number,
  opRunId: number,
  fieldSeqNo: number,
) {
  const stepRun = await erpDb.stepRun.findUnique({
    where: { id },
    include: {
      step: {
        select: {
          multiSet: true,
          fieldSet: {
            select: {
              fields: {
                where: { seqNo: fieldSeqNo },
                select: {
                  id: true,
                  fieldSetId: true,
                  seqNo: true,
                  label: true,
                  type: true,
                  multiValue: true,
                  required: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!stepRun || stepRun.operationRunId !== opRunId) return null;
  return stepRun;
}

// --- Serialization ---

/**
 * Serialize a field value for DB storage.
 * - Scalar (string): stored as-is
 * - Array (string[]): stored as JSON array string
 */
export function serializeFieldValue(value: FieldValue): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Deserialize a DB-stored value back to the API shape.
 * - multiValue fields: parse JSON array, falling back to comma-split for legacy data
 * - Scalar fields: return as-is
 */
export function deserializeFieldValue(
  dbValue: string,
  multiValue: boolean,
): FieldValue {
  if (!multiValue) return dbValue;
  if (!dbValue) return [];

  // Try JSON array first (new format)
  if (dbValue.startsWith("[")) {
    try {
      const parsed = JSON.parse(dbValue);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // fall through to legacy
    }
  }

  // Legacy: comma-separated string — migrate on read
  return dbValue.split(",").map((v) => v.trim());
}

// --- Validation ---

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;

function validateSingleValue(type: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;

  switch (type) {
    case FieldType.number:
      if (isNaN(Number(v))) return "Must be a number";
      break;
    case FieldType.date:
      if (!DATE_RE.test(v) || isNaN(Date.parse(v)))
        return "Must be a valid date (YYYY-MM-DD)";
      break;
    case FieldType.datetime:
      if (!DATETIME_RE.test(v) || isNaN(Date.parse(v)))
        return "Must be a valid date/time (YYYY-MM-DDTHH:mm)";
      break;
    case FieldType.yesNo:
      if (v !== "Yes" && v !== "No") return 'Must be "Yes" or "No"';
      break;
    case FieldType.checkbox:
      if (v !== "checked") return "Invalid checkbox value";
      break;
  }
  return null;
}

export function validateFieldValue(
  type: string,
  multiValue: boolean,
  required: boolean,
  value: FieldValue,
): FieldValidation {
  if (multiValue) {
    const items = Array.isArray(value) ? value : [value];
    if (required && items.every((v) => !v.trim())) {
      return { valid: false, error: "Required" };
    }
    for (let i = 0; i < items.length; i++) {
      const err = validateSingleValue(type, items[i]);
      if (err) {
        return { valid: false, error: `Item ${i + 1}: ${err}` };
      }
    }
  } else {
    const v = typeof value === "string" ? value : value.join("");
    if (required && !v.trim()) {
      return { valid: false, error: "Required" };
    }
    const err = validateSingleValue(type, v);
    if (err) {
      return { valid: false, error: err };
    }
  }
  return { valid: true };
}

function fieldValueKey(fieldId: number, setIndex: number): string {
  return `${fieldId}_${setIndex}`;
}

export function validateCompletionFields(
  existing: StepRunWithStepAndFields,
): string | null {
  const existingFieldValues = existing.fieldRecord?.fieldValues ?? [];

  // Build a map of field definitions keyed by id for multiValue lookup
  const fieldDefs = new Map(
    (existing.step.fieldSet?.fields ?? []).map((f) => [f.id, f]),
  );

  const storedMap = new Map(
    existingFieldValues.map((fv) => {
      const def = fieldDefs.get(fv.fieldId);
      return [
        fieldValueKey(fv.fieldId, fv.setIndex),
        deserializeFieldValue(fv.value, def?.multiValue ?? false),
      ];
    }),
  );

  // Determine how many sets exist
  const allSetIndexes = new Set<number>();
  for (const fv of existingFieldValues) allSetIndexes.add(fv.setIndex);
  if (allSetIndexes.size === 0) allSetIndexes.add(0);

  const errors: string[] = [];
  for (const si of [...allSetIndexes].sort((a, b) => a - b)) {
    for (const field of existing.step.fieldSet?.fields ?? []) {
      const key = fieldValueKey(field.id, si);
      const value = storedMap.get(key) ?? "";
      const result = validateFieldValue(
        field.type,
        field.multiValue,
        field.required,
        value,
      );
      if (!result.valid) {
        const prefix = existing.step.multiSet ? `Set ${si + 1} / ` : "";
        errors.push(`${prefix}${field.label}: ${result.error}`);
      }
    }
  }

  if (errors.length > 0) {
    return `Cannot complete step:\n${errors.join("\n")}`;
  }
  return null;
}

// --- Attachment value helpers ---

export function formatAttachmentLabel(
  filename: string,
  fileSize: number,
): string {
  return `${filename} (${formatFileSize(fileSize)})`;
}

/**
 * Query current attachments for a field value and rebuild the stored value
 * to reflect them. Returns the new API-shape value.
 */
export async function rebuildAttachmentFieldValue(
  fieldRecordId: number,
  fieldId: number,
  setIndex: number,
  multiValue: boolean,
  userId: number,
): Promise<FieldValue> {
  const fieldValue = await erpDb.fieldValue.findUnique({
    where: {
      fieldRecordId_fieldId_setIndex: { fieldRecordId, fieldId, setIndex },
    },
    include: {
      fieldAttachments: {
        include: {
          attachment: { select: { filename: true, fileSize: true } },
        },
      },
    },
  });

  const labels = (fieldValue?.fieldAttachments ?? []).map((fa) =>
    formatAttachmentLabel(fa.attachment.filename, fa.attachment.fileSize),
  );

  const value: FieldValue =
    labels.length === 0
      ? multiValue
        ? []
        : ""
      : multiValue
        ? labels
        : labels[0];

  await upsertFieldValue(fieldRecordId, fieldId, setIndex, value, userId);
  return value;
}

/**
 * Clear an attachment field: delete all FieldAttachment links and set value to empty.
 */
export async function clearAttachmentFieldValue(
  fieldRecordId: number,
  fieldId: number,
  setIndex: number,
  userId: number,
): Promise<void> {
  const fieldValue = await erpDb.fieldValue.findUnique({
    where: {
      fieldRecordId_fieldId_setIndex: { fieldRecordId, fieldId, setIndex },
    },
    select: { id: true },
  });

  if (fieldValue) {
    await erpDb.fieldAttachment.deleteMany({
      where: { fieldValueId: fieldValue.id },
    });
  }

  const empty: FieldValue = "";
  await upsertFieldValue(fieldRecordId, fieldId, setIndex, empty, userId);
}

// --- Mutations ---

export async function upsertFieldValue(
  fieldRecordId: number,
  fieldId: number,
  setIndex: number,
  value: FieldValue,
  userId: number,
) {
  const dbValue = serializeFieldValue(value);
  await erpDb.fieldValue.upsert({
    where: {
      fieldRecordId_fieldId_setIndex: { fieldRecordId, fieldId, setIndex },
    },
    create: {
      fieldRecordId,
      fieldId,
      setIndex,
      value: dbValue,
      createdById: userId,
      updatedById: userId,
    },
    update: {
      value: dbValue,
      updatedById: userId,
    },
  });
}

export async function deleteFieldValueSet(
  fieldRecordId: number,
  setIndex: number,
): Promise<void> {
  await erpDb.$transaction(async (erpTx) => {
    // Delete all field values for this set
    await erpTx.fieldValue.deleteMany({
      where: { fieldRecordId, setIndex },
    });

    // Re-index higher sets to fill the gap
    await erpTx.$executeRawUnsafe(
      `UPDATE field_values SET set_index = set_index - 1 WHERE field_record_id = ? AND set_index > ?`,
      fieldRecordId,
      setIndex,
    );
  });
}
