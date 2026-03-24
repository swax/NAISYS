import erpDb from "../erpDb.js";
import type { WorkCenterModel } from "../generated/prisma/models/WorkCenter.js";
import { includeUsers, type WithAuditUsers } from "../route-helpers.js";

// --- Prisma include & result type ---

const includeDetail = {
  ...includeUsers,
  userAssignments: {
    include: {
      user: { select: { id: true, username: true } },
      createdBy: { select: { username: true } },
    },
    orderBy: { user: { username: "asc" as const } },
  },
  _count: { select: { userAssignments: true } },
} as const;

export type WorkCenterWithDetail = WorkCenterModel &
  WithAuditUsers & {
    userAssignments: Array<{
      user: { id: number; username: string };
      createdBy: { username: string };
      createdAt: Date;
    }>;
    _count: { userAssignments: number };
  };

// --- Lookups ---

export async function listWorkCenters(
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<[WorkCenterWithDetail[], number]> {
  return Promise.all([
    erpDb.workCenter.findMany({
      where,
      include: includeDetail,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    erpDb.workCenter.count({ where }),
  ]);
}

export async function findExisting(
  key: string,
): Promise<WorkCenterWithDetail | null> {
  return erpDb.workCenter.findUnique({
    where: { key },
    include: includeDetail,
  });
}

// --- Mutations ---

export async function createWorkCenter(
  key: string,
  description: string | undefined,
  userId: number,
): Promise<WorkCenterWithDetail> {
  return erpDb.workCenter.create({
    data: {
      key,
      description,
      createdById: userId,
      updatedById: userId,
    },
    include: includeDetail,
  });
}

export async function updateWorkCenter(
  key: string,
  data: Record<string, unknown>,
  userId: number,
): Promise<WorkCenterWithDetail> {
  return erpDb.workCenter.update({
    where: { key },
    data: { ...data, updatedById: userId },
    include: includeDetail,
  });
}

export async function deleteWorkCenter(key: string): Promise<void> {
  await erpDb.workCenter.delete({ where: { key } });
}

// --- User assignments ---

export async function assignUser(
  workCenterKey: string,
  username: string,
  createdById: number,
): Promise<WorkCenterWithDetail> {
  const workCenter = await erpDb.workCenter.findUniqueOrThrow({
    where: { key: workCenterKey },
  });
  const user = await erpDb.user.findUniqueOrThrow({
    where: { username },
  });

  await erpDb.workCenterUser.create({
    data: {
      workCenterId: workCenter.id,
      userId: user.id,
      createdById,
    },
  });

  return erpDb.workCenter.findUniqueOrThrow({
    where: { key: workCenterKey },
    include: includeDetail,
  });
}

export async function removeUser(
  workCenterKey: string,
  username: string,
): Promise<void> {
  const workCenter = await erpDb.workCenter.findUniqueOrThrow({
    where: { key: workCenterKey },
  });
  const user = await erpDb.user.findUniqueOrThrow({
    where: { username },
  });

  await erpDb.workCenterUser.delete({
    where: {
      workCenterId_userId: {
        workCenterId: workCenter.id,
        userId: user.id,
      },
    },
  });
}

// --- Work center ID lookups for dispatch ---

export async function getUserWorkCenterIds(userId: number): Promise<number[]> {
  const assignments = await erpDb.workCenterUser.findMany({
    where: { userId },
    select: { workCenterId: true },
  });
  return assignments.map((a) => a.workCenterId);
}

export async function findWorkCenterByKey(
  key: string,
): Promise<{ id: number } | null> {
  return erpDb.workCenter.findUnique({
    where: { key },
    select: { id: true },
  });
}
