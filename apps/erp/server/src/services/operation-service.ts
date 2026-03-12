import erpDb from "../erpDb.js";
import type { OperationModel } from "../generated/prisma/models/Operation.js";
import {
  calcNextSeqNo,
  includeUsers,
  type WithAuditUsers,
} from "../route-helpers.js";

// --- Prisma include & result type ---

export type OperationWithUsers = OperationModel & WithAuditUsers;

// --- Lookups ---

export async function listOperations(
  orderRevId: number,
): Promise<OperationWithUsers[]> {
  return erpDb.operation.findMany({
    where: { orderRevId },
    include: includeUsers,
    orderBy: { seqNo: "asc" },
  });
}

export async function getOperation(
  orderRevId: number,
  seqNo: number,
): Promise<OperationWithUsers | null> {
  return erpDb.operation.findFirst({
    where: { orderRevId, seqNo },
    include: includeUsers,
  });
}

export async function findExisting(orderRevId: number, seqNo: number) {
  return erpDb.operation.findFirst({
    where: { orderRevId, seqNo },
  });
}

// --- Mutations ---

export async function createOperation(
  orderRevId: number,
  requestedSeqNo: number | undefined,
  title: string,
  description: string | undefined,
  userId: number,
): Promise<OperationWithUsers> {
  return erpDb.$transaction(async (erpTx) => {
    const maxSeq = await erpTx.operation.findFirst({
      where: { orderRevId },
      orderBy: { seqNo: "desc" },
      select: { seqNo: true },
    });
    const defaultSeqNo = calcNextSeqNo(maxSeq?.seqNo ?? 0);
    const nextSeqNo = requestedSeqNo ?? defaultSeqNo;

    return erpTx.operation.create({
      data: {
        orderRevId,
        seqNo: nextSeqNo,
        title,
        description: description ?? "",
        createdById: userId,
        updatedById: userId,
      },
      include: includeUsers,
    });
  });
}

export async function updateOperation(
  id: number,
  data: {
    title?: string;
    description?: string;
    seqNo?: number;
  },
  userId: number,
): Promise<OperationWithUsers> {
  return erpDb.operation.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.seqNo !== undefined ? { seqNo: data.seqNo } : {}),
      updatedById: userId,
    },
    include: includeUsers,
  });
}

export async function deleteOperation(id: number): Promise<void> {
  await erpDb.operation.delete({ where: { id } });
}
