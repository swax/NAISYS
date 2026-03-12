import {
  type RevisionStatus,
  RevisionStatus as RevisionStatusValues,
} from "@naisys-erp/shared";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import type { OrderRevisionModel } from "../generated/prisma/models/OrderRevision.js";
import { includeUsers, type WithAuditUsers } from "../route-helpers.js";

// --- Prisma include & result type ---

export type OrderRevisionWithUsers = OrderRevisionModel & WithAuditUsers;

// --- Lookups ---

export async function listRevisions(
  orderId: number,
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<[OrderRevisionWithUsers[], number]> {
  const fullWhere = { orderId, ...where };
  return Promise.all([
    erpDb.orderRevision.findMany({
      where: fullWhere,
      include: includeUsers,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { revNo: "desc" },
    }),
    erpDb.orderRevision.count({ where: fullWhere }),
  ]);
}

export async function getRevision(
  orderId: number,
  revNo: number,
): Promise<OrderRevisionWithUsers | null> {
  return erpDb.orderRevision.findFirst({
    where: { orderId, revNo },
    include: includeUsers,
  });
}

export async function findExisting(orderId: number, revNo: number) {
  return erpDb.orderRevision.findFirst({
    where: { orderId, revNo },
    include: includeUsers,
  });
}

// --- Validation ---

export function validateDraftStatus(status: string): string | null {
  if (status !== RevisionStatusValues.draft) {
    return `Cannot update revision in ${status} status`;
  }
  return null;
}

export async function checkHasOrderRuns(
  revisionId: number,
): Promise<string | null> {
  const orderRunCount = await erpDb.orderRun.count({
    where: { orderRevId: revisionId },
  });
  if (orderRunCount > 0) {
    return "Cannot delete revision with existing order runs.";
  }
  return null;
}

// --- Mutations ---

export async function createRevision(
  orderId: number,
  data: { notes?: string | null; changeSummary?: string | null },
  userId: number,
): Promise<OrderRevisionWithUsers> {
  return erpDb.$transaction(async (erpTx) => {
    const prevRev = await erpTx.orderRevision.findFirst({
      where: { orderId },
      orderBy: { revNo: "desc" },
      include: {
        operations: {
          include: {
            steps: {
              include: { fields: true },
            },
          },
        },
      },
    });
    const nextRevNo = (prevRev?.revNo ?? 0) + 1;

    const newRev = await erpTx.orderRevision.create({
      data: {
        orderId,
        revNo: nextRevNo,
        notes: data.notes ?? null,
        changeSummary: data.changeSummary ?? null,
        createdById: userId,
        updatedById: userId,
      },
      include: includeUsers,
    });

    // Copy operations, steps, and fields from the previous revision
    if (prevRev) {
      for (const op of prevRev.operations) {
        const newOp = await erpTx.operation.create({
          data: {
            orderRevId: newRev.id,
            seqNo: op.seqNo,
            title: op.title,
            description: op.description,
            createdById: userId,
            updatedById: userId,
          },
        });

        for (const step of op.steps) {
          const newStep = await erpTx.step.create({
            data: {
              operationId: newOp.id,
              seqNo: step.seqNo,
              instructions: step.instructions,
              createdById: userId,
              updatedById: userId,
            },
          });

          for (const field of step.fields) {
            await erpTx.stepField.create({
              data: {
                stepId: newStep.id,
                seqNo: field.seqNo,
                label: field.label,
                type: field.type,
                required: field.required,
                createdById: userId,
                updatedById: userId,
              },
            });
          }
        }
      }
    }

    return newRev;
  });
}

export async function updateRevision(
  id: number,
  data: { notes?: string | null; changeSummary?: string | null },
  userId: number,
): Promise<OrderRevisionWithUsers> {
  return erpDb.orderRevision.update({
    where: { id },
    data: {
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.changeSummary !== undefined
        ? { changeSummary: data.changeSummary }
        : {}),
      updatedById: userId,
    },
    include: includeUsers,
  });
}

export async function deleteRevision(id: number): Promise<void> {
  await erpDb.orderRevision.delete({ where: { id } });
}

export async function transitionStatus(
  id: number,
  action: string,
  fromStatus: RevisionStatus,
  toStatus: RevisionStatus,
  userId: number,
): Promise<OrderRevisionWithUsers> {
  return erpDb.$transaction(async (erpTx) => {
    const updated = await erpTx.orderRevision.update({
      where: { id },
      data: { status: toStatus, updatedById: userId },
      include: includeUsers,
    });
    await writeAuditEntry(
      erpTx,
      "OrderRevision",
      id,
      action,
      "status",
      fromStatus,
      toStatus,
      userId,
    );
    return updated;
  });
}
