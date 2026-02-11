import type { PrismaClient } from "./generated/prisma/client.js";

type PrismaTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

export async function writeAuditEntry(
  tx: PrismaTransaction,
  entityType: string,
  entityId: number,
  action: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  userId: number,
) {
  await tx.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      field,
      oldValue,
      newValue,
      userId,
    },
  });
}
