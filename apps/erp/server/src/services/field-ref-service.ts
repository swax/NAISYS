import erpDb from "../erpDb.js";

const includeFieldRef = {
  sourceStep: {
    select: {
      seqNo: true,
      title: true,
      operation: { select: { seqNo: true, title: true } },
      fieldSet: {
        select: {
          fields: {
            select: { seqNo: true, label: true, type: true },
            orderBy: { seqNo: "asc" as const },
          },
        },
      },
    },
  },
  createdBy: { select: { username: true } },
} as const;

export type FieldRefWithDetails = Awaited<
  ReturnType<typeof listFieldRefs>
>[number];

export async function listFieldRefs(operationId: number) {
  return erpDb.operationFieldRef.findMany({
    where: { operationId },
    include: includeFieldRef,
    orderBy: { seqNo: "asc" },
  });
}

export async function getFieldRef(operationId: number, seqNo: number) {
  return erpDb.operationFieldRef.findFirst({
    where: { operationId, seqNo },
    include: includeFieldRef,
  });
}

export async function createFieldRef(
  operationId: number,
  seqNo: number | undefined,
  title: string,
  sourceStepId: number,
  userId: number,
) {
  // Auto-assign seqNo if not provided
  let assignedSeqNo = seqNo;
  if (!assignedSeqNo) {
    const maxRow = await erpDb.operationFieldRef.findFirst({
      where: { operationId },
      orderBy: { seqNo: "desc" },
      select: { seqNo: true },
    });
    const maxSeq = maxRow?.seqNo ?? 0;
    assignedSeqNo = Math.ceil((maxSeq + 1) / 10) * 10;
  }

  return erpDb.operationFieldRef.create({
    data: {
      operationId,
      seqNo: assignedSeqNo,
      title,
      sourceStepId,
      createdById: userId,
    },
    include: includeFieldRef,
  });
}

export async function deleteFieldRef(id: number) {
  await erpDb.operationFieldRef.delete({ where: { id } });
}

export async function findExistingFieldRef(operationId: number, seqNo: number) {
  return erpDb.operationFieldRef.findFirst({
    where: { operationId, seqNo },
    select: { id: true },
  });
}

/**
 * Check if a source step already has a field ref for this operation.
 */
export async function checkDuplicateSource(
  operationId: number,
  sourceStepId: number,
) {
  return erpDb.operationFieldRef.findFirst({
    where: { operationId, sourceStepId },
    select: { id: true },
  });
}
