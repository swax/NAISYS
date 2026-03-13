import { StepFieldType, type StepFieldValidation } from "@naisys-erp/shared";

import erpDb from "../erpDb.js";

// --- Prisma include & result type ---

export const includeStep = {
  step: {
    select: {
      seqNo: true,
      instructions: true,
      fields: {
        select: {
          id: true,
          seqNo: true,
          label: true,
          type: true,
          required: true,
        },
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
    fields: {
      id: number;
      seqNo: number;
      label: string;
      type: string;
      required: boolean;
    }[];
  };
  fieldValues: { stepFieldId: number; value: string }[];
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

export function validateFieldValue(
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

export function validateCompletionFields(
  existing: StepRunWithStep,
  submittedFieldValues?: { stepFieldId: number; value: string }[],
): string | null {
  const submittedMap = new Map(
    (submittedFieldValues ?? []).map((fv) => [fv.stepFieldId, fv.value]),
  );
  const storedMap = new Map(
    existing.fieldValues.map((fv) => [fv.stepFieldId, fv.value]),
  );

  const errors: string[] = [];
  for (const field of existing.step.fields) {
    const value = submittedMap.get(field.id) ?? storedMap.get(field.id) ?? "";
    const result = validateFieldValue(field.type, field.required, value);
    if (!result.valid) {
      errors.push(`${field.label}: ${result.error}`);
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
  fieldValues: { stepFieldId: number; value: string }[] | undefined,
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
}

export async function upsertFieldValue(
  stepRunId: number,
  stepFieldId: number,
  value: string,
  userId: number,
) {
  await erpDb.stepFieldValue.upsert({
    where: {
      stepRunId_stepFieldId: { stepRunId, stepFieldId },
    },
    create: {
      stepRunId,
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
}
