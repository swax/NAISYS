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
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type OpRunWithOp = OperationRunModel & {
  operation: { seqNo: number; title: string; description: string };
  createdBy: { username: string };
  updatedBy: { username: string };
};

// --- Lookups ---

export async function listOpRuns(runId: number): Promise<OpRunWithOp[]> {
  return erpDb.operationRun.findMany({
    where: { orderRunId: runId },
    include: includeOp,
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

export async function checkPriorOpsComplete(
  runId: number,
  seqNo: number,
): Promise<string | null> {
  const incompletePrior = await erpDb.operationRun.findMany({
    where: {
      orderRunId: runId,
      operation: { seqNo: { lt: seqNo } },
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
  return `Cannot start: prior operations not complete — ${labels.join(", ")}`;
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
  data: { feedback?: string | null },
  userId: number,
): Promise<OpRunWithOp> {
  const updateData: Record<string, unknown> = { updatedById: userId };
  if (data.feedback !== undefined) updateData.feedback = data.feedback;

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
