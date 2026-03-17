import { StepFieldType } from "@naisys-erp/shared";

import erpDb from "../erpDb.js";
import type { StepFieldModel } from "../generated/prisma/models/StepField.js";
import {
  calcNextSeqNo,
  includeUsers,
  resolveStep,
  type WithAuditUsers,
} from "../route-helpers.js";

// --- Prisma include & result type ---

export type StepFieldWithUsers = StepFieldModel & WithAuditUsers;

// --- Lookups ---

export async function listStepFields(
  stepId: number,
): Promise<StepFieldWithUsers[]> {
  return erpDb.stepField.findMany({
    where: { stepId },
    include: includeUsers,
    orderBy: { seqNo: "asc" },
  });
}

export async function getStepField(
  stepId: number,
  fieldSeqNo: number,
): Promise<StepFieldWithUsers | null> {
  return erpDb.stepField.findFirst({
    where: { stepId, seqNo: fieldSeqNo },
    include: includeUsers,
  });
}

export async function findExisting(stepId: number, fieldSeqNo: number) {
  return erpDb.stepField.findFirst({
    where: { stepId, seqNo: fieldSeqNo },
  });
}

// --- Validation ---

export async function resolveStepForField(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
) {
  return resolveStep(orderKey, revNo, opSeqNo, stepSeqNo);
}

// --- Mutations ---

export async function createStepField(
  stepId: number,
  data: {
    seqNo?: number | null;
    label: string;
    type?: StepFieldType | null;
    multiValue?: boolean | null;
    required?: boolean | null;
  },
  userId: number,
): Promise<StepFieldWithUsers> {
  return erpDb.$transaction(async (erpTx) => {
    const maxSeq = await erpTx.stepField.findFirst({
      where: { stepId },
      orderBy: { seqNo: "desc" },
      select: { seqNo: true },
    });
    const defaultSeqNo = calcNextSeqNo(maxSeq?.seqNo ?? 0);
    const nextSeqNo = data.seqNo ?? defaultSeqNo;

    return erpTx.stepField.create({
      data: {
        stepId,
        seqNo: nextSeqNo,
        label: data.label,
        type: data.type ?? StepFieldType.string,
        multiValue: data.multiValue ?? false,
        required: data.required ?? false,
        createdById: userId,
        updatedById: userId,
      },
      include: includeUsers,
    });
  }) as Promise<StepFieldWithUsers>;
}

export async function updateStepField(
  id: number,
  data: {
    label?: string;
    type?: StepFieldType;
    multiValue?: boolean;
    required?: boolean;
    seqNo?: number;
  },
  userId: number,
): Promise<StepFieldWithUsers> {
  return erpDb.stepField.update({
    where: { id },
    data: {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.multiValue !== undefined ? { multiValue: data.multiValue } : {}),
      ...(data.required !== undefined ? { required: data.required } : {}),
      ...(data.seqNo !== undefined ? { seqNo: data.seqNo } : {}),
      updatedById: userId,
    },
    include: includeUsers,
  });
}

export async function deleteStepField(id: number): Promise<void> {
  await erpDb.stepField.delete({ where: { id } });
}
