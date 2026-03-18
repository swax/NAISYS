import erpDb from "../erpDb.js";
import type { ItemInstanceModel } from "../generated/prisma/models/ItemInstance.js";
import { includeUsers, type WithAuditUsers } from "../route-helpers.js";

// --- Prisma include & result type ---

export const includeItemInstanceRelations = {
  ...includeUsers,
  item: { select: { key: true } },
  orderRun: {
    select: {
      runNo: true,
      order: { select: { key: true } },
    },
  },
} as const;

export type ItemInstanceWithRelations = ItemInstanceModel &
  WithAuditUsers & {
    item: { key: string };
    orderRun: { runNo: number; order: { key: string } } | null;
  };

// --- Lookups ---

export async function listItemInstances(
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<[ItemInstanceWithRelations[], number]> {
  return Promise.all([
    erpDb.itemInstance.findMany({
      where,
      include: includeItemInstanceRelations,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    erpDb.itemInstance.count({ where }),
  ]);
}

export async function findItemInstance(
  id: number,
): Promise<ItemInstanceWithRelations | null> {
  return erpDb.itemInstance.findUnique({
    where: { id },
    include: includeItemInstanceRelations,
  });
}

export async function findItemInstanceByItemAndKey(
  itemId: number,
  key: string,
): Promise<ItemInstanceWithRelations | null> {
  return erpDb.itemInstance.findUnique({
    where: { itemId_key: { itemId, key } },
    include: includeItemInstanceRelations,
  });
}

// --- Mutations ---

export async function createItemInstance(
  itemId: number,
  key: string,
  quantity: number | null | undefined,
  orderRunId: number | null | undefined,
  userId: number,
): Promise<ItemInstanceWithRelations> {
  return erpDb.itemInstance.create({
    data: {
      itemId,
      key,
      quantity: quantity ?? null,
      orderRunId: orderRunId ?? null,
      createdById: userId,
      updatedById: userId,
    },
    include: includeItemInstanceRelations,
  });
}

export async function updateItemInstance(
  id: number,
  data: Record<string, unknown>,
  userId: number,
): Promise<ItemInstanceWithRelations> {
  return erpDb.itemInstance.update({
    where: { id },
    data: { ...data, updatedById: userId },
    include: includeItemInstanceRelations,
  });
}

export async function deleteItemInstance(id: number): Promise<void> {
  await erpDb.itemInstance.delete({ where: { id } });
}
