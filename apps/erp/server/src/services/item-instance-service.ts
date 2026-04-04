import erpDb from "../erpDb.js";
import type { ItemInstanceModel } from "../generated/prisma/models/ItemInstance.js";
import { includeUsers, type WithAuditUsers } from "../route-helpers.js";

// --- Prisma include & result type ---

export const includeItemInstanceRelations = {
  ...includeUsers,
  item: {
    select: {
      key: true,
      fieldSet: {
        select: {
          id: true,
          fields: {
            select: {
              id: true,
              seqNo: true,
              label: true,
              type: true,
              isArray: true,
              required: true,
            },
            orderBy: { seqNo: "asc" as const },
          },
        },
      },
    },
  },
  orderRun: {
    select: {
      runNo: true,
      order: { select: { key: true } },
    },
  },
  fieldRecord: {
    include: {
      fieldValues: {
        select: {
          id: true,
          fieldId: true,
          setIndex: true,
          value: true,
          fieldAttachments: {
            select: {
              attachment: {
                select: { publicId: true, filename: true, fileSize: true },
              },
            },
          },
        },
        orderBy: { setIndex: "asc" as const },
      },
    },
  },
} as const;

type FieldDef = {
  id: number;
  seqNo: number;
  label: string;
  type: string;
  isArray: boolean;
  required: boolean;
};

export type ItemInstanceWithRelations = ItemInstanceModel &
  WithAuditUsers & {
    item: {
      key: string;
      fieldSet: { id: number; fields: FieldDef[] } | null;
    };
    orderRun: { runNo: number; order: { key: string } } | null;
    fieldRecordId: number | null;
    fieldRecord: {
      id: number;
      fieldValues: {
        id: number;
        fieldId: number;
        setIndex: number;
        value: string;
        fieldAttachments: {
          attachment: { publicId: string; filename: string; fileSize: number };
        }[];
      }[];
    } | null;
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

export async function findItemInstanceWithField(
  id: number,
  fieldSeqNo: number,
) {
  return erpDb.itemInstance.findUnique({
    where: { id },
    include: {
      item: {
        select: {
          fieldSet: {
            select: {
              id: true,
              fields: {
                where: { seqNo: fieldSeqNo },
                select: {
                  id: true,
                  seqNo: true,
                  label: true,
                  type: true,
                  isArray: true,
                  required: true,
                },
              },
            },
          },
        },
      },
    },
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

/**
 * Get or create a FieldRecord for an ItemInstance, linking it back.
 * Returns the fieldRecordId, or null if the item has no fieldSet.
 */
export async function ensureItemInstanceFieldRecord(
  instanceId: number,
  userId: number,
): Promise<number | null> {
  const inst = await erpDb.itemInstance.findUniqueOrThrow({
    where: { id: instanceId },
    select: {
      fieldRecordId: true,
      item: { select: { fieldSetId: true } },
    },
  });
  if (inst.fieldRecordId) return inst.fieldRecordId;
  if (!inst.item.fieldSetId) return null;

  const fr = await erpDb.fieldRecord.create({
    data: { fieldSetId: inst.item.fieldSetId, createdById: userId },
  });
  await erpDb.itemInstance.update({
    where: { id: instanceId },
    data: { fieldRecordId: fr.id },
  });
  return fr.id;
}
