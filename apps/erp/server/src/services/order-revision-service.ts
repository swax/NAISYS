import {
  type RevisionStatus,
  RevisionStatus as RevisionStatusValues,
} from "@naisys-erp/shared";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import type { OrderRevisionModel } from "../generated/prisma/models/OrderRevision.js";
import { includeUsers, type WithAuditUsers } from "../route-helpers.js";

// --- Prisma include & result type ---

const includeRevisionRelations = {
  ...includeUsers,
  order: { select: { item: { select: { key: true } } } },
} as const;

export type OrderRevisionWithRelations = OrderRevisionModel &
  WithAuditUsers & { order: { item: { key: string } | null } };

// --- Lookups ---

export async function listRevisions(
  orderId: number,
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<[OrderRevisionWithRelations[], number]> {
  const fullWhere = { orderId, ...where };
  return Promise.all([
    erpDb.orderRevision.findMany({
      where: fullWhere,
      include: includeRevisionRelations,
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
): Promise<OrderRevisionWithRelations | null> {
  return erpDb.orderRevision.findFirst({
    where: { orderId, revNo },
    include: includeRevisionRelations,
  });
}

export async function findExisting(orderId: number, revNo: number) {
  return erpDb.orderRevision.findFirst({
    where: { orderId, revNo },
    include: includeRevisionRelations,
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
  data: { description?: string; changeSummary?: string | null },
  userId: number,
): Promise<OrderRevisionWithRelations> {
  return erpDb.$transaction(async (erpTx) => {
    const prevRev = await erpTx.orderRevision.findFirst({
      where: { orderId },
      orderBy: { revNo: "desc" },
      include: {
        operations: {
          include: {
            steps: {
              include: {
                fieldSet: { include: { fields: true } },
              },
            },
            predecessors: true,
          },
        },
      },
    });
    const nextRevNo = (prevRev?.revNo ?? 0) + 1;

    // Seed description: explicit value > previous rev's description > order's description
    let resolvedDescription = data.description;
    if (resolvedDescription === undefined) {
      if (prevRev) {
        resolvedDescription = prevRev.description;
      } else {
        const order = await erpTx.order.findUniqueOrThrow({
          where: { id: orderId },
        });
        resolvedDescription = order.description;
      }
    }

    const newRev = await erpTx.orderRevision.create({
      data: {
        orderId,
        revNo: nextRevNo,
        description: resolvedDescription,
        changeSummary: data.changeSummary ?? null,
        createdById: userId,
        updatedById: userId,
      },
      include: includeRevisionRelations,
    });

    // Copy operations, steps, fields, and dependencies from the previous revision
    if (prevRev) {
      const oldToNewOpId = new Map<number, number>();

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
        oldToNewOpId.set(op.id, newOp.id);

        for (const step of op.steps) {
          const fields = step.fieldSet?.fields ?? [];
          let newFieldSetId: number | null = null;

          if (fields.length > 0) {
            const newFieldSet = await erpTx.fieldSet.create({
              data: { createdById: userId },
            });
            newFieldSetId = newFieldSet.id;

            for (const field of fields) {
              await erpTx.field.create({
                data: {
                  fieldSetId: newFieldSet.id,
                  seqNo: field.seqNo,
                  label: field.label,
                  type: field.type,
                  multiValue: field.multiValue,
                  required: field.required,
                  createdById: userId,
                  updatedById: userId,
                },
              });
            }
          }

          await erpTx.step.create({
            data: {
              operationId: newOp.id,
              seqNo: step.seqNo,
              instructions: step.instructions,
              multiSet: step.multiSet,
              fieldSetId: newFieldSetId,
              createdById: userId,
              updatedById: userId,
            },
          });
        }
      }

      // Copy operation dependencies using the old-to-new ID mapping
      for (const op of prevRev.operations) {
        for (const dep of op.predecessors) {
          const newSuccessorId = oldToNewOpId.get(dep.successorId);
          const newPredecessorId = oldToNewOpId.get(dep.predecessorId);
          if (newSuccessorId && newPredecessorId) {
            await erpTx.operationDependency.create({
              data: {
                successorId: newSuccessorId,
                predecessorId: newPredecessorId,
                createdById: userId,
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
  data: { description?: string; changeSummary?: string | null },
  userId: number,
): Promise<OrderRevisionWithRelations> {
  return erpDb.orderRevision.update({
    where: { id },
    data: {
      ...(data.description !== undefined
        ? { description: data.description }
        : {}),
      ...(data.changeSummary !== undefined
        ? { changeSummary: data.changeSummary }
        : {}),
      updatedById: userId,
    },
    include: includeRevisionRelations,
  });
}

export async function deleteRevision(id: number): Promise<void> {
  await erpDb.$transaction(async (erpTx) => {
    // Delete child records bottom-up: step fields → steps → operations → revision
    const operations = await erpTx.operation.findMany({
      where: { orderRevId: id },
      select: { id: true },
    });
    const opIds = operations.map((op) => op.id);

    if (opIds.length > 0) {
      const steps = await erpTx.step.findMany({
        where: { operationId: { in: opIds } },
        select: { id: true, fieldSetId: true },
      });
      const fieldSetIds = steps
        .map((s) => s.fieldSetId)
        .filter((id): id is number => id !== null);

      // Fields cascade-delete from field_sets; steps cascade-delete from operations
      if (fieldSetIds.length > 0) {
        await erpTx.fieldSet.deleteMany({
          where: { id: { in: fieldSetIds } },
        });
      }
      await erpTx.step.deleteMany({
        where: { operationId: { in: opIds } },
      });
      await erpTx.operation.deleteMany({
        where: { orderRevId: id },
      });
    }

    await erpTx.orderRevision.delete({ where: { id } });
  });
}

export async function transitionStatus(
  id: number,
  action: string,
  fromStatus: RevisionStatus,
  toStatus: RevisionStatus,
  userId: number,
): Promise<OrderRevisionWithRelations> {
  return erpDb.$transaction(async (erpTx) => {
    const updated = await erpTx.orderRevision.update({
      where: { id },
      data: { status: toStatus, updatedById: userId },
      include: includeRevisionRelations,
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
