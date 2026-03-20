import erpDb from "../erpDb.js";
import type { StepModel } from "../generated/prisma/models/Step.js";
import {
  calcNextSeqNo,
  includeUsers,
  type WithAuditUsers,
} from "../route-helpers.js";
import type { FieldWithUsers } from "./field-service.js";

// --- Prisma include & result type ---

export const includeUsersAndFields = {
  ...includeUsers,
  fieldSet: {
    include: {
      fields: {
        include: includeUsers,
        orderBy: { seqNo: "asc" as const },
      },
    },
  },
} as const;

export type StepWithUsersAndFields = StepModel &
  WithAuditUsers & {
    fieldSet: { fields: FieldWithUsers[] } | null;
  };

// --- Lookups ---

export async function listSteps(
  operationId: number,
): Promise<StepWithUsersAndFields[]> {
  return erpDb.step.findMany({
    where: { operationId },
    include: includeUsersAndFields,
    orderBy: { seqNo: "asc" },
  });
}

export async function getStep(
  operationId: number,
  seqNo: number,
): Promise<StepWithUsersAndFields | null> {
  return erpDb.step.findFirst({
    where: { operationId, seqNo },
    include: includeUsersAndFields,
  });
}

export async function findExisting(operationId: number, seqNo: number) {
  return erpDb.step.findFirst({
    where: { operationId, seqNo },
    include: includeUsersAndFields,
  });
}

// --- Mutations ---

export async function createStep(
  operationId: number,
  requestedSeqNo: number | undefined | null,
  title: string | undefined | null,
  instructions: string | undefined | null,
  multiSet: boolean | undefined | null,
  userId: number,
): Promise<StepWithUsersAndFields> {
  return erpDb.$transaction(async (erpTx) => {
    const maxSeq = await erpTx.step.findFirst({
      where: { operationId },
      orderBy: { seqNo: "desc" },
      select: { seqNo: true },
    });
    const defaultSeqNo = calcNextSeqNo(maxSeq?.seqNo ?? 0);
    const nextSeqNo = requestedSeqNo ?? defaultSeqNo;

    return erpTx.step.create({
      data: {
        operationId,
        seqNo: nextSeqNo,
        title: title ?? "",
        instructions: instructions ?? "",
        multiSet: multiSet ?? false,
        createdById: userId,
        updatedById: userId,
      },
      include: includeUsersAndFields,
    });
  });
}

export async function updateStep(
  id: number,
  data: { title?: string; instructions?: string; seqNo?: number; multiSet?: boolean },
  userId: number,
): Promise<StepWithUsersAndFields> {
  return erpDb.step.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.instructions !== undefined
        ? { instructions: data.instructions }
        : {}),
      ...(data.seqNo !== undefined ? { seqNo: data.seqNo } : {}),
      ...(data.multiSet !== undefined ? { multiSet: data.multiSet } : {}),
      updatedById: userId,
    },
    include: includeUsersAndFields,
  });
}

export async function deleteStep(id: number): Promise<void> {
  await erpDb.step.delete({ where: { id } });
}
