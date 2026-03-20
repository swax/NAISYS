import { FieldType, type FieldValidation } from "@naisys-erp/shared";

import erpDb from "../erpDb.js";

// --- Prisma include & result type ---

export const includeStep = {
  step: {
    select: {
      seqNo: true,
      title: true,
      instructions: true,
      multiSet: true,
      fieldSet: {
        select: {
          fields: {
            select: {
              id: true,
              seqNo: true,
              label: true,
              type: true,
              multiValue: true,
              required: true,
            },
            orderBy: { seqNo: "asc" as const },
          },
        },
      },
    },
  },
  fieldRecord: {
    include: {
      fieldValues: {
        select: {
          id: true,
          fieldId: true,
          setIndex: true,
          value: true,
          fieldAttachments: {
            select: {
              attachment: {
                select: { id: true, filename: true, fileSize: true },
              },
            },
          },
        },
        orderBy: { setIndex: "asc" as const },
      },
    },
  },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type StepRunWithStep = {
  id: number;
  operationRunId: number;
  stepId: number;
  completed: boolean;
  completionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  step: {
    seqNo: number;
    title: string;
    instructions: string;
    multiSet: boolean;
    fieldSet: {
      fields: {
        id: number;
        seqNo: number;
        label: string;
        type: string;
        multiValue: boolean;
        required: boolean;
      }[];
    } | null;
  };
  fieldRecordId: number | null;
  fieldRecord: {
    id: number;
    fieldValues: {
      id: number;
      fieldId: number;
      setIndex: number;
      value: string;
      fieldAttachments: {
        attachment: { id: number; filename: string; fileSize: number };
      }[];
    }[];
  } | null;
  createdBy: { username: string };
  updatedBy: { username: string };
};

// --- Lookups ---

export async function listStepRuns(
  opRunId: number,
): Promise<StepRunWithStep[]> {
  return erpDb.stepRun.findMany({
    where: { operationRunId: opRunId },
    include: includeStep,
    orderBy: { step: { seqNo: "asc" } },
  });
}

export async function getStepRun(id: number): Promise<StepRunWithStep | null> {
  return erpDb.stepRun.findUnique({
    where: { id },
    include: includeStep,
  });
}

export async function findExisting(id: number, opRunId: number) {
  const existing = await erpDb.stepRun.findUnique({
    where: { id },
    include: includeStep,
  });
  if (!existing || existing.operationRunId !== opRunId) return null;
  return existing;
}

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
          fieldSet: {
            select: {
              fields: {
                where: { seqNo: fieldSeqNo },
                select: {
                  id: true,
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
  value: string,
): FieldValidation {
  if (required && !value.trim()) {
    return { valid: false, error: "Required" };
  }
  if (multiValue) {
    const items = value.split(",").map((v) => v.trim());
    for (let i = 0; i < items.length; i++) {
      const err = validateSingleValue(type, items[i]);
      if (err) {
        return { valid: false, error: `Item ${i + 1}: ${err}` };
      }
    }
  } else {
    const err = validateSingleValue(type, value);
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
  existing: StepRunWithStep,
  submittedFieldValues?: {
    fieldId: number;
    value: string;
    setIndex?: number;
  }[],
): string | null {
  const submittedMap = new Map(
    (submittedFieldValues ?? []).map((fv) => [
      fieldValueKey(fv.fieldId, fv.setIndex ?? 0),
      fv.value,
    ]),
  );
  const existingFieldValues = existing.fieldRecord?.fieldValues ?? [];
  const storedMap = new Map(
    existingFieldValues.map((fv) => [
      fieldValueKey(fv.fieldId, fv.setIndex),
      fv.value,
    ]),
  );

  // Determine how many sets exist
  const allSetIndexes = new Set<number>();
  for (const fv of existingFieldValues) allSetIndexes.add(fv.setIndex);
  for (const fv of submittedFieldValues ?? [])
    allSetIndexes.add(fv.setIndex ?? 0);
  if (allSetIndexes.size === 0) allSetIndexes.add(0);

  const errors: string[] = [];
  for (const si of [...allSetIndexes].sort((a, b) => a - b)) {
    for (const field of existing.step.fieldSet?.fields ?? []) {
      const key = fieldValueKey(field.id, si);
      const value = submittedMap.get(key) ?? storedMap.get(key) ?? "";
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
    return `Cannot complete step: ${errors.join(", ")}`;
  }
  return null;
}

// --- Mutations ---

export async function updateStepRun(
  id: number,
  completed: boolean | undefined,
  completionNote: string | undefined,
  fieldValues:
    | { fieldId: number; value: string; setIndex?: number }[]
    | undefined,
  userId: number,
): Promise<StepRunWithStep> {
  return erpDb.$transaction(async (erpTx) => {
    if (completed !== undefined) {
      await erpTx.stepRun.update({
        where: { id },
        data: {
          completed,
          completionNote: completed ? (completionNote ?? null) : null,
          updatedById: userId,
        },
      });
    }

    if (fieldValues && fieldValues.length > 0) {
      // Ensure field record exists
      const sr = await erpTx.stepRun.findUniqueOrThrow({
        where: { id },
        select: { fieldRecordId: true, step: { select: { fieldSetId: true } } },
      });
      let fieldRecordId = sr.fieldRecordId;

      if (!fieldRecordId) {
        if (sr.step.fieldSetId) {
          const fr = await erpTx.fieldRecord.create({
            data: { fieldSetId: sr.step.fieldSetId, createdById: userId },
          });
          fieldRecordId = fr.id;
          await erpTx.stepRun.update({
            where: { id },
            data: { fieldRecordId },
          });
        }
      }

      if (fieldRecordId) {
        for (const fv of fieldValues) {
          const setIndex = fv.setIndex ?? 0;
          await erpTx.fieldValue.upsert({
            where: {
              fieldRecordId_fieldId_setIndex: {
                fieldRecordId,
                fieldId: fv.fieldId,
                setIndex,
              },
            },
            create: {
              fieldRecordId,
              fieldId: fv.fieldId,
              setIndex,
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
    }

    return erpTx.stepRun.findUniqueOrThrow({
      where: { id },
      include: includeStep,
    });
  });
}

export async function upsertFieldValue(
  fieldRecordId: number,
  fieldId: number,
  setIndex: number,
  value: string,
  userId: number,
) {
  await erpDb.fieldValue.upsert({
    where: {
      fieldRecordId_fieldId_setIndex: { fieldRecordId, fieldId, setIndex },
    },
    create: {
      fieldRecordId,
      fieldId,
      setIndex,
      value,
      createdById: userId,
      updatedById: userId,
    },
    update: {
      value,
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
