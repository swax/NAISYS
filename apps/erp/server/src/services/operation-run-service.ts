import {
  type OperationRunStatus,
  OperationRunStatus as OperationRunStatusValues,
} from "@naisys-erp/shared";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import type { OperationRunModel } from "../generated/prisma/models/OperationRun.js";

// --- Prisma include & result type ---

export const includeOp = {
  operation: { select: { seqNo: true, title: true, description: true } },
  assignedTo: { select: { username: true } },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type OpRunWithOp = OperationRunModel & {
  operation: { seqNo: number; title: string; description: string };
  assignedTo: { username: string } | null;
  createdBy: { username: string };
  updatedBy: { username: string };
};

export type OpRunWithSummary = OpRunWithOp & {
  _count: { stepRuns: number };
  operation: {
    seqNo: number;
    title: string;
    description: string;
    predecessors: Array<{
      predecessor: { seqNo: number; title: string };
    }>;
  };
};

// --- Lookups ---

export async function listOpRuns(runId: number): Promise<OpRunWithSummary[]> {
  return erpDb.operationRun.findMany({
    where: { orderRunId: runId },
    include: {
      operation: {
        select: {
          seqNo: true,
          title: true,
          description: true,
          predecessors: {
            include: { predecessor: { select: { seqNo: true, title: true } } },
            orderBy: { predecessor: { seqNo: "asc" } },
          },
        },
      },
      _count: { select: { stepRuns: true } },
      assignedTo: { select: { username: true } },
      createdBy: { select: { username: true } },
      updatedBy: { select: { username: true } },
    },
    orderBy: { operation: { seqNo: "asc" } },
  });
}

export async function getOpRun(id: number): Promise<OpRunWithOp | null> {
  return erpDb.operationRun.findUnique({
    where: { id },
    include: includeOp,
  });
}

const includeOpSeqNo = {
  operation: { select: { seqNo: true } },
} as const;

export async function findExisting(id: number, runId: number) {
  const existing = await erpDb.operationRun.findUnique({
    where: { id },
    include: includeOpSeqNo,
  });
  if (!existing || existing.orderRunId !== runId) return null;
  return existing;
}

// --- Validation ---

export function validateStatusFor(
  action: string,
  currentStatus: string,
  allowedStatuses: string[],
): string | null {
  if (!allowedStatuses.includes(currentStatus)) {
    return `Cannot ${action} operation run in ${currentStatus} status`;
  }
  return null;
}

/**
 * Check that all predecessor dependencies for this operation are complete.
 * Uses the OperationDependency graph rather than seqNo ordering.
 */
export async function checkPredecessorsComplete(
  runId: number,
  operationId: number,
): Promise<string | null> {
  // Get predecessor operation IDs from dependency graph
  const deps = await erpDb.operationDependency.findMany({
    where: { successorId: operationId },
    select: { predecessorId: true },
  });
  if (deps.length === 0) return null;

  const predecessorIds = deps.map((d) => d.predecessorId);

  const incompletePrior = await erpDb.operationRun.findMany({
    where: {
      orderRunId: runId,
      operationId: { in: predecessorIds },
      status: {
        notIn: [
          OperationRunStatusValues.completed,
          OperationRunStatusValues.skipped,
        ],
      },
    },
    include: { operation: { select: { seqNo: true, title: true } } },
  });
  if (incompletePrior.length === 0) return null;
  const labels = incompletePrior.map(
    (op) => `Op ${op.operation.seqNo} "${op.operation.title}" (${op.status})`,
  );
  return `Cannot start: predecessor operations not complete — ${labels.join(", ")}`;
}

/**
 * After completing/skipping an operation, unblock successor ops
 * whose predecessors are now all complete.
 */
export async function unblockSuccessors(
  runId: number,
  operationId: number,
  userId: number,
): Promise<void> {
  // Find successor operations via dependency graph
  const successorDeps = await erpDb.operationDependency.findMany({
    where: { predecessorId: operationId },
    select: { successorId: true },
  });
  if (successorDeps.length === 0) return;

  for (const { successorId } of successorDeps) {
    // Only unblock if the successor op run is currently blocked
    const successorRun = await erpDb.operationRun.findFirst({
      where: {
        orderRunId: runId,
        operationId: successorId,
        status: OperationRunStatusValues.blocked,
      },
    });
    if (!successorRun) continue;

    // Check if ALL predecessors of this successor are complete
    const allPredDeps = await erpDb.operationDependency.findMany({
      where: { successorId },
      select: { predecessorId: true },
    });
    const predIds = allPredDeps.map((d) => d.predecessorId);

    const incompleteCount = await erpDb.operationRun.count({
      where: {
        orderRunId: runId,
        operationId: { in: predIds },
        status: {
          notIn: [
            OperationRunStatusValues.completed,
            OperationRunStatusValues.skipped,
          ],
        },
      },
    });

    if (incompleteCount === 0) {
      await erpDb.operationRun.update({
        where: { id: successorRun.id },
        data: {
          status: OperationRunStatusValues.pending,
          updatedById: userId,
        },
      });
    }
  }
}

/**
 * After reopening an operation, re-block successor ops that are still pending
 * (haven't been started yet) if this operation is one of their prerequisites.
 */
export async function reblockSuccessors(
  runId: number,
  operationId: number,
  userId: number,
): Promise<void> {
  const successorDeps = await erpDb.operationDependency.findMany({
    where: { predecessorId: operationId },
    select: { successorId: true },
  });
  if (successorDeps.length === 0) return;

  for (const { successorId } of successorDeps) {
    // Only re-block if successor is still pending (not started/in_progress/etc.)
    await erpDb.operationRun.updateMany({
      where: {
        orderRunId: runId,
        operationId: successorId,
        status: OperationRunStatusValues.pending,
      },
      data: {
        status: OperationRunStatusValues.blocked,
        updatedById: userId,
      },
    });
  }
}

export async function checkStepsComplete(
  opRunId: number,
): Promise<string | null> {
  const incompleteSteps = await erpDb.stepRun.findMany({
    where: { operationRunId: opRunId, completed: false },
    include: { step: { select: { seqNo: true } } },
  });
  if (incompleteSteps.length === 0) return null;
  const labels = incompleteSteps.map((s) => `Step ${s.step.seqNo}`);
  return `Cannot complete operation: incomplete steps — ${labels.join(", ")}`;
}

// --- Mutations ---

export async function updateOpRun(
  id: number,
  data: { assignedToId?: number | null },
  userId: number,
): Promise<OpRunWithOp> {
  const updateData: Record<string, unknown> = { updatedById: userId };
  if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;

  return erpDb.operationRun.update({
    where: { id },
    data: updateData,
    include: includeOp,
  });
}

export async function transitionStatus(
  id: number,
  action: string,
  fromStatus: OperationRunStatus,
  toStatus: OperationRunStatus,
  userId: number,
  extraData?: Record<string, unknown>,
): Promise<OpRunWithOp> {
  return erpDb.$transaction(async (erpTx) => {
    const updated = await erpTx.operationRun.update({
      where: { id },
      data: { status: toStatus, updatedById: userId, ...extraData },
      include: includeOp,
    });
    await writeAuditEntry(
      erpTx,
      "OperationRun",
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
