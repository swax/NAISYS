import erpDb from "../erpDb.js";
import type { OrderModel } from "../generated/prisma/models/Order.js";
import { includeUsers, type WithAuditUsers } from "../route-helpers.js";

// --- Prisma include & result type ---

export type OrderWithUsers = OrderModel & WithAuditUsers;

// --- Lookups ---

export async function listOrders(
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<[OrderWithUsers[], number]> {
  return Promise.all([
    erpDb.order.findMany({
      where,
      include: includeUsers,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    erpDb.order.count({ where }),
  ]);
}

export async function findExisting(
  key: string,
): Promise<OrderWithUsers | null> {
  return erpDb.order.findUnique({
    where: { key },
    include: includeUsers,
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

export async function createOrder(
  key: string,
  description: string | undefined,
  userId: number,
): Promise<OrderWithUsers> {
  return erpDb.order.create({
    data: {
      key,
      description,
      createdById: userId,
      updatedById: userId,
    },
    include: includeUsers,
  });
}

export async function updateOrder(
  key: string,
  data: Record<string, unknown>,
  userId: number,
): Promise<OrderWithUsers> {
  return erpDb.order.update({
    where: { key },
    data: { ...data, updatedById: userId },
    include: includeUsers,
  });
}

export async function deleteOrder(key: string): Promise<void> {
  await erpDb.order.delete({ where: { key } });
}
