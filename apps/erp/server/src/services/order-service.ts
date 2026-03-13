import erpDb from "../erpDb.js";
import type { OrderModel } from "../generated/prisma/models/Order.js";
import { includeUsers, type WithAuditUsers } from "../route-helpers.js";

// --- Prisma include & result type ---

const includeOrderRelations = {
  ...includeUsers,
  item: { select: { key: true } },
} as const;

export type OrderWithRelations = OrderModel &
  WithAuditUsers & { item: { key: string } | null };

// --- Lookups ---

export async function listOrders(
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<[OrderWithRelations[], number]> {
  return Promise.all([
    erpDb.order.findMany({
      where,
      include: includeOrderRelations,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    erpDb.order.count({ where }),
  ]);
}

export async function findExisting(
  key: string,
): Promise<OrderWithRelations | null> {
  return erpDb.order.findUnique({
    where: { key },
    include: includeOrderRelations,
  });
}

// --- Validation ---

export async function checkHasRevisions(orderId: number): Promise<boolean> {
  const revisionCount = await erpDb.orderRevision.count({
    where: { orderId },
  });
  return revisionCount > 0;
}

// --- Mutations ---

export async function resolveItemKey(
  itemKey: string | undefined | null,
): Promise<number | null> {
  if (!itemKey) return null;
  const item = await erpDb.item.findUnique({
    where: { key: itemKey },
    select: { id: true },
  });
  if (!item) throw new Error(`Item '${itemKey}' not found`);
  return item.id;
}

export async function createOrder(
  key: string,
  description: string | undefined,
  itemId: number | null,
  userId: number,
): Promise<OrderWithRelations> {
  return erpDb.order.create({
    data: {
      key,
      description,
      itemId,
      createdById: userId,
      updatedById: userId,
    },
    include: includeOrderRelations,
  });
}

export async function updateOrder(
  key: string,
  data: Record<string, unknown>,
  userId: number,
): Promise<OrderWithRelations> {
  return erpDb.order.update({
    where: { key },
    data: { ...data, updatedById: userId },
    include: includeOrderRelations,
  });
}

export async function deleteOrder(key: string): Promise<void> {
  await erpDb.order.delete({ where: { key } });
}
