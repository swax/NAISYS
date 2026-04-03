import { FieldType } from "@naisys/erp-shared";

import erpDb from "../erpDb.js";
import type { FieldModel } from "../generated/prisma/models/Field.js";
import {
  calcNextSeqNo,
  includeUsers,
  type WithAuditUsers,
} from "../route-helpers.js";

// --- Prisma include & result type ---

export type FieldWithUsers = FieldModel & WithAuditUsers;

// --- Lookups ---

export async function listFields(
  fieldSetId: number,
): Promise<FieldWithUsers[]> {
  return erpDb.field.findMany({
    where: { fieldSetId },
    include: includeUsers,
    orderBy: { seqNo: "asc" },
  });
}

export async function getField(
  fieldSetId: number,
  fieldSeqNo: number,
): Promise<FieldWithUsers | null> {
  return erpDb.field.findFirst({
    where: { fieldSetId, seqNo: fieldSeqNo },
    include: includeUsers,
  });
}

export async function findExistingField(
  fieldSetId: number,
  fieldSeqNo: number,
) {
  return erpDb.field.findFirst({
    where: { fieldSetId, seqNo: fieldSeqNo },
  });
}

// --- FieldSet / FieldRecord helpers ---

export async function ensureFieldSet(
  fieldSetId: number | null,
  userId: number,
): Promise<number> {
  if (fieldSetId) return fieldSetId;
  const fs = await erpDb.fieldSet.create({
    data: { createdById: userId },
  });
  return fs.id;
}

export async function ensureFieldRecord(
  fieldRecordId: number | null,
  fieldSetId: number,
  userId: number,
): Promise<number> {
  if (fieldRecordId) return fieldRecordId;
  const fr = await erpDb.fieldRecord.create({
    data: { fieldSetId, createdById: userId },
  });
  return fr.id;
}

/**
 * Get or create a FieldRecord for a StepRun, linking it back.
 * Returns the fieldRecordId, or null if the step has no fieldSet.
 */
export async function ensureStepRunFieldRecord(
  stepRunId: number,
  userId: number,
): Promise<number | null> {
  const sr = await erpDb.stepRun.findUniqueOrThrow({
    where: { id: stepRunId },
    select: { fieldRecordId: true, step: { select: { fieldSetId: true } } },
  });
  if (sr.fieldRecordId) return sr.fieldRecordId;
  if (!sr.step.fieldSetId) return null;
  const fieldRecordId = await ensureFieldRecord(
    null,
    sr.step.fieldSetId,
    userId,
  );
  await erpDb.stepRun.update({
    where: { id: stepRunId },
    data: { fieldRecordId },
  });
  return fieldRecordId;
}

// --- Mutations ---

export async function createFields(
  fieldSetId: number,
  items: Array<{
    seqNo?: number | null;
    label: string;
    type?: FieldType | null;
    isArray?: boolean | null;
    required?: boolean | null;
  }>,
  userId: number,
): Promise<FieldWithUsers[]> {
  return erpDb.$transaction(async (erpTx) => {
    const maxSeq = await erpTx.field.findFirst({
      where: { fieldSetId },
      orderBy: { seqNo: "desc" },
      select: { seqNo: true },
    });
    let nextSeqNo = calcNextSeqNo(maxSeq?.seqNo ?? 0);

    const created: FieldWithUsers[] = [];
    for (const item of items) {
      const seqNo = item.seqNo ?? nextSeqNo;
      const field = await erpTx.field.create({
        data: {
          fieldSetId,
          seqNo,
          label: item.label,
          type: item.type ?? FieldType.string,
          isArray: item.isArray ?? false,
          required: item.required ?? false,
          createdById: userId,
          updatedById: userId,
        },
        include: includeUsers,
      });
      created.push(field as FieldWithUsers);
      if (!item.seqNo) {
        nextSeqNo = calcNextSeqNo(seqNo);
      }
    }
    return created;
  });
}

export async function createField(
  fieldSetId: number,
  data: {
    seqNo?: number | null;
    label: string;
    type?: FieldType | null;
    isArray?: boolean | null;
    required?: boolean | null;
  },
  userId: number,
): Promise<FieldWithUsers> {
  const [field] = await createFields(fieldSetId, [data], userId);
  return field;
}

export async function updateField(
  id: number,
  data: {
    label?: string;
    type?: FieldType;
    isArray?: boolean;
    required?: boolean;
    seqNo?: number;
  },
  userId: number,
): Promise<FieldWithUsers> {
  return erpDb.field.update({
    where: { id },
    data: {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.isArray !== undefined ? { isArray: data.isArray } : {}),
      ...(data.required !== undefined ? { required: data.required } : {}),
      ...(data.seqNo !== undefined ? { seqNo: data.seqNo } : {}),
      updatedById: userId,
    },
    include: includeUsers,
  });
}

export async function deleteField(id: number): Promise<void> {
  await erpDb.field.delete({ where: { id } });
}
