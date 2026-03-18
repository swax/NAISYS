import erpDb from "../erpDb.js";
import type { ItemModel } from "../generated/prisma/models/Item.js";
import { includeUsers, type WithAuditUsers } from "../route-helpers.js";
import type { FieldWithUsers } from "./field-service.js";

// --- Prisma include & result type ---

export const includeUsersAndFieldSet = {
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

export type ItemWithUsers = ItemModel &
  WithAuditUsers & {
    fieldSet: { fields: FieldWithUsers[] } | null;
  };

// --- Lookups ---

export async function listItems(
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<[ItemWithUsers[], number]> {
  return Promise.all([
    erpDb.item.findMany({
      where,
      include: includeUsersAndFieldSet,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    erpDb.item.count({ where }),
  ]);
}

export async function findExisting(key: string): Promise<ItemWithUsers | null> {
  return erpDb.item.findUnique({
    where: { key },
    include: includeUsersAndFieldSet,
  });
}

// --- Mutations ---

export async function createItem(
  key: string,
  description: string | undefined,
  userId: number,
): Promise<ItemWithUsers> {
  return erpDb.item.create({
    data: {
      key,
      description,
      createdById: userId,
      updatedById: userId,
    },
    include: includeUsersAndFieldSet,
  });
}

export async function updateItem(
  key: string,
  data: Record<string, unknown>,
  userId: number,
): Promise<ItemWithUsers> {
  return erpDb.item.update({
    where: { key },
    data: { ...data, updatedById: userId },
    include: includeUsersAndFieldSet,
  });
}

export async function deleteItem(key: string): Promise<void> {
  await erpDb.item.delete({ where: { key } });
}
