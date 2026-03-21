import erpDb from "../erpDb.js";
import type { OperationModel } from "../generated/prisma/models/Operation.js";
import {
  calcNextSeqNo,
  includeUsers,
  type WithAuditUsers,
} from "../route-helpers.js";

// --- Prisma include & result type ---

export type OperationWithUsers = OperationModel & WithAuditUsers;

export type OperationWithSummary = OperationWithUsers & {
  _count: { steps: number };
  predecessors: Array<{
    predecessor: { seqNo: number; title: string };
  }>;
};

// --- Lookups ---

export async function listOperations(
  orderRevId: number,
): Promise<OperationWithSummary[]> {
  return erpDb.operation.findMany({
    where: { orderRevId },
    include: {
      ...includeUsers,
      _count: { select: { steps: true } },
      predecessors: {
        include: { predecessor: { select: { seqNo: true, title: true } } },
        orderBy: { predecessor: { seqNo: "asc" } },
      },
    },
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
  predecessorSeqNos: number[] | undefined,
  userId: number,
): Promise<OperationWithSummary> {
  return erpDb.$transaction(async (erpTx) => {
    const maxSeq = await erpTx.operation.findFirst({
      where: { orderRevId },
      orderBy: { seqNo: "desc" },
      select: { seqNo: true },
    });
    const defaultSeqNo = calcNextSeqNo(maxSeq?.seqNo ?? 0);
    const nextSeqNo = requestedSeqNo ?? defaultSeqNo;

    const created = await erpTx.operation.create({
      data: {
        orderRevId,
        seqNo: nextSeqNo,
        title,
        description: description ?? "",
        createdById: userId,
        updatedById: userId,
      },
    });

    if (predecessorSeqNos !== undefined) {
      // Use explicitly provided predecessors
      for (const predSeqNo of predecessorSeqNos) {
        const predOp = await erpTx.operation.findFirst({
          where: { orderRevId, seqNo: predSeqNo },
          select: { id: true },
        });
        if (predOp) {
          await erpTx.operationDependency.create({
            data: {
              successorId: created.id,
              predecessorId: predOp.id,
              createdById: userId,
            },
          });
        }
      }
    } else {
      // Auto-create dependency on the previous operation (by seqNo)
      const previousOp = await erpTx.operation.findFirst({
        where: { orderRevId, seqNo: { lt: nextSeqNo } },
        orderBy: { seqNo: "desc" },
        select: { id: true },
      });

      if (previousOp) {
        await erpTx.operationDependency.create({
          data: {
            successorId: created.id,
            predecessorId: previousOp.id,
            createdById: userId,
          },
        });
      }
    }

    // Re-fetch with summary data (predecessors + step count)
    return erpTx.operation.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        ...includeUsers,
        _count: { select: { steps: true } },
        predecessors: {
          include: { predecessor: { select: { seqNo: true, title: true } } },
          orderBy: { predecessor: { seqNo: "asc" } },
        },
      },
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
