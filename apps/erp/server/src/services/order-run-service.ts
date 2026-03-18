import {
  OperationRunStatus as OperationRunStatusValues,
  type OrderRunPriority,
  type OrderRunStatus,
  OrderRunStatus as OrderRunStatusValues,
} from "@naisys-erp/shared";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import type { OrderRunModel } from "../generated/prisma/models/OrderRun.js";

// --- Prisma include & result type ---

export const includeRev = {
  orderRev: { select: { revNo: true } },
  order: { select: { item: { select: { key: true } } } },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type OrderRunWithRev = OrderRunModel & {
  orderRev: { revNo: number };
  order: { item: { key: string } | null };
  createdBy: { username: string };
  updatedBy: { username: string };
};

// --- Lookups ---

export async function listOrderRuns(
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<{ items: OrderRunWithRev[]; total: number }> {
  const [items, total] = await Promise.all([
    erpDb.orderRun.findMany({
      where,
      include: includeRev,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    erpDb.orderRun.count({ where }),
  ]);
  return { items, total };
}

export async function getOrderRun(id: number): Promise<OrderRunWithRev | null> {
  return erpDb.orderRun.findUnique({
    where: { id },
    include: includeRev,
  });
}

export async function findExisting(id: number, orderId: number) {
  const existing = await erpDb.orderRun.findUnique({ where: { id } });
  if (!existing || existing.orderId !== orderId) return null;
  return existing;
}

// --- Validation ---

export function validateStatusFor(
  action: string,
  currentStatus: string,
  allowedStatuses: string[],
): string | null {
  if (!allowedStatuses.includes(currentStatus)) {
    return `Cannot ${action} order run in ${currentStatus} status`;
  }
  return null;
}

export async function checkOpsComplete(
  orderRunId: number,
): Promise<string | null> {
  const incompleteOps = await erpDb.operationRun.findMany({
    where: {
      orderRunId,
      status: {
        notIn: [
          OperationRunStatusValues.completed,
          OperationRunStatusValues.skipped,
        ],
      },
    },
    include: { operation: { select: { seqNo: true, title: true } } },
  });
  if (incompleteOps.length === 0) return null;
  const labels = incompleteOps.map(
    (op) => `Op ${op.operation.seqNo} "${op.operation.title}" (${op.status})`,
  );
  return `Cannot close order run: incomplete operations — ${labels.join(", ")}`;
}

// --- Mutations ---

export async function createOrderRun(
  orderId: number,
  orderRevId: number,
  data: {
    priority: OrderRunPriority;
    scheduledStartAt?: string | null;
    dueAt?: string | null;
    assignedTo?: string | null;
    notes?: string | null;
  },
  userId: number,
): Promise<OrderRunWithRev> {
  return erpDb.$transaction(async (erpTx) => {
    const maxOrder = await erpTx.orderRun.findFirst({
      where: { orderId },
      orderBy: { runNo: "desc" },
      select: { runNo: true },
    });
    const nextRunNo = (maxOrder?.runNo ?? 0) + 1;

    const orderRun = await erpTx.orderRun.create({
      data: {
        runNo: nextRunNo,
        orderId,
        orderRevId,
        priority: data.priority,
        scheduledStartAt: data.scheduledStartAt
          ? new Date(data.scheduledStartAt)
          : null,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        assignedTo: data.assignedTo ?? null,
        notes: data.notes ?? null,
        createdById: userId,
        updatedById: userId,
      },
      include: includeRev,
    });

    // Fetch operations -> steps -> fields for this revision
    const operations = await erpTx.operation.findMany({
      where: { orderRevId },
      include: {
        steps: {
          include: { fieldSet: { include: { fields: true } } },
          orderBy: { seqNo: "asc" },
        },
        predecessors: { select: { predecessorId: true } },
      },
      orderBy: { seqNo: "asc" },
    });

    // Create OperationRun -> StepRun -> StepFieldValue rows
    for (const op of operations) {
      // Ops with predecessors start blocked; ops without start pending
      const initialStatus =
        op.predecessors.length > 0
          ? OperationRunStatusValues.blocked
          : OperationRunStatusValues.pending;

      const opRun = await erpTx.operationRun.create({
        data: {
          orderRunId: orderRun.id,
          operationId: op.id,
          status: initialStatus,
          createdById: userId,
          updatedById: userId,
        },
      });

      for (const step of op.steps) {
        const stepRun = await erpTx.stepRun.create({
          data: {
            operationRunId: opRun.id,
            stepId: step.id,
            createdById: userId,
            updatedById: userId,
          },
        });

        for (const field of step.fieldSet?.fields ?? []) {
          await erpTx.stepFieldValue.create({
            data: {
              stepRunId: stepRun.id,
              stepFieldId: field.id,
              value: "",
              createdById: userId,
              updatedById: userId,
            },
          });
        }
      }
    }

    return orderRun;
  });
}

export async function updateOrderRun(
  id: number,
  data: {
    priority?: OrderRunPriority;
    assignedTo?: string | null;
    notes?: string | null;
    scheduledStartAt?: string | null;
    dueAt?: string | null;
  },
  userId: number,
): Promise<OrderRunWithRev> {
  const updateData: Record<string, unknown> = { updatedById: userId };
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.scheduledStartAt !== undefined) {
    updateData.scheduledStartAt = data.scheduledStartAt
      ? new Date(data.scheduledStartAt)
      : null;
  }
  if (data.dueAt !== undefined) {
    updateData.dueAt = data.dueAt ? new Date(data.dueAt) : null;
  }

  return erpDb.orderRun.update({
    where: { id },
    data: updateData,
    include: includeRev,
  });
}

export async function deleteOrderRun(id: number): Promise<void> {
  await erpDb.orderRun.delete({ where: { id } });
}

export async function transitionStatus(
  id: number,
  action: string,
  fromStatus: OrderRunStatus,
  toStatus: OrderRunStatus,
  userId: number,
): Promise<OrderRunWithRev> {
  return erpDb.$transaction(async (erpTx) => {
    const updated = await erpTx.orderRun.update({
      where: { id },
      data: { status: toStatus, updatedById: userId },
      include: includeRev,
    });
    await writeAuditEntry(
      erpTx,
      "OrderRun",
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

export async function findOrderRevision(orderId: number, revNo: number) {
  return erpDb.orderRevision.findUnique({
    where: { orderId_revNo: { orderId, revNo } },
  });
}

export function getReopenTarget(currentStatus: OrderRunStatus): OrderRunStatus {
  return currentStatus === OrderRunStatusValues.closed
    ? OrderRunStatusValues.started
    : OrderRunStatusValues.released;
}
