import erpDb from "../erpDb.js";

const depInclude = {
  predecessor: { select: { seqNo: true, title: true } },
  createdBy: { select: { username: true } },
} as const;

export type DependencyWithDetails = Awaited<
  ReturnType<typeof listDependencies>
>[number];

export async function listDependencies(operationId: number) {
  return erpDb.operationDependency.findMany({
    where: { successorId: operationId },
    include: depInclude,
    orderBy: { predecessor: { seqNo: "asc" } },
  });
}

export async function createDependency(
  successorId: number,
  predecessorId: number,
  userId: number,
) {
  return erpDb.operationDependency.create({
    data: {
      successorId,
      predecessorId,
      createdById: userId,
    },
    include: depInclude,
  });
}

export async function deleteDependency(
  successorId: number,
  predecessorId: number,
) {
  await erpDb.operationDependency.delete({
    where: {
      successorId_predecessorId: { successorId, predecessorId },
    },
  });
}
