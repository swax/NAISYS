import { StepFieldType, type StepFieldValidation } from "@naisys-erp/shared";

import erpDb from "../erpDb.js";

// --- Prisma include & result type ---

export const includeStep = {
  step: {
    select: {
      seqNo: true,
      instructions: true,
      multiSet: true,
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
  fieldValues: {
    select: {
      id: true,
      stepFieldId: true,
      setIndex: true,
      value: true,
      stepFieldAttachments: {
        select: {
          attachment: {
            select: { id: true, filename: true, fileSize: true },
          },
        },
      },
    },
    orderBy: { setIndex: "asc" as const },
  },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type StepRunWithStep = {
  id: number;
  operationRunId: number;
  stepId: number;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
  step: {
    seqNo: number;
    instructions: string;
    multiSet: boolean;
    fields: {
      id: number;
      seqNo: number;
      label: string;
      type: string;
      multiValue: boolean;
      required: boolean;
    }[];
  };
  fieldValues: {
    id: number;
    stepFieldId: number;
    setIndex: number;
    value: string;
    stepFieldAttachments: {
      attachment: { id: number; filename: string; fileSize: number };
    }[];
  }[];
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
    case StepFieldType.number:
      if (isNaN(Number(v))) return "Must be a number";
      break;
    case StepFieldType.date:
      if (!DATE_RE.test(v) || isNaN(Date.parse(v)))
        return "Must be a valid date (YYYY-MM-DD)";
      break;
    case StepFieldType.datetime:
      if (!DATETIME_RE.test(v) || isNaN(Date.parse(v)))
        return "Must be a valid date/time (YYYY-MM-DDTHH:mm)";
      break;
    case StepFieldType.yesNo:
      if (v !== "Yes" && v !== "No") return 'Must be "Yes" or "No"';
      break;
    case StepFieldType.checkbox:
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
): StepFieldValidation {
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

function fieldValueKey(stepFieldId: number, setIndex: number): string {
  return `${stepFieldId}_${setIndex}`;
}

export function validateCompletionFields(
  existing: StepRunWithStep,
  submittedFieldValues?: {
    stepFieldId: number;
    value: string;
    setIndex?: number;
  }[],
): string | null {
  const submittedMap = new Map(
    (submittedFieldValues ?? []).map((fv) => [
      fieldValueKey(fv.stepFieldId, fv.setIndex ?? 0),
      fv.value,
    ]),
  );
  const storedMap = new Map(
    existing.fieldValues.map((fv) => [
      fieldValueKey(fv.stepFieldId, fv.setIndex),
      fv.value,
    ]),
  );

  // Determine how many sets exist
  const allSetIndexes = new Set<number>();
  for (const fv of existing.fieldValues) allSetIndexes.add(fv.setIndex);
  for (const fv of submittedFieldValues ?? [])
    allSetIndexes.add(fv.setIndex ?? 0);
  if (allSetIndexes.size === 0) allSetIndexes.add(0);

  const errors: string[] = [];
  for (const si of [...allSetIndexes].sort((a, b) => a - b)) {
    for (const field of existing.step.fields) {
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
  fieldValues:
    | { stepFieldId: number; value: string; setIndex?: number }[]
    | undefined,
  userId: number,
): Promise<StepRunWithStep> {
  return erpDb.$transaction(async (erpTx) => {
    if (completed !== undefined) {
      await erpTx.stepRun.update({
        where: { id },
        data: { completed, updatedById: userId },
      });
    }

    if (fieldValues && fieldValues.length > 0) {
      for (const fv of fieldValues) {
        const setIndex = fv.setIndex ?? 0;
        await erpTx.stepFieldValue.upsert({
          where: {
            stepRunId_stepFieldId_setIndex: {
              stepRunId: id,
              stepFieldId: fv.stepFieldId,
              setIndex,
            },
          },
          create: {
            stepRunId: id,
            stepFieldId: fv.stepFieldId,
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

    return erpTx.stepRun.findUniqueOrThrow({
      where: { id },
      include: includeStep,
    });
  });
}

export async function upsertFieldValue(
  stepRunId: number,
  stepFieldId: number,
  setIndex: number,
  value: string,
  userId: number,
) {
  await erpDb.stepFieldValue.upsert({
    where: {
      stepRunId_stepFieldId_setIndex: { stepRunId, stepFieldId, setIndex },
    },
    create: {
      stepRunId,
      stepFieldId,
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
  stepRunId: number,
  setIndex: number,
): Promise<void> {
  await erpDb.$transaction(async (erpTx) => {
    // Delete all field values for this set
    await erpTx.stepFieldValue.deleteMany({
      where: { stepRunId, setIndex },
    });

    // Re-index higher sets to fill the gap
    await erpTx.$executeRawUnsafe(
      `UPDATE step_field_values SET set_index = set_index - 1 WHERE step_run_id = ? AND set_index > ?`,
      stepRunId,
      setIndex,
    );
  });
}
