import {
  type OperationRunStatus,
  OperationRunStatus as OperationRunStatusValues,
} from "@naisys-erp/shared";
import {
  type FieldRefValueSummary,
  getValueFormatHint,
} from "@naisys-erp/shared";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import { API_PREFIX } from "../hateoas.js";
import type { OperationRunModel } from "../generated/prisma/models/OperationRun.js";
import {
  deserializeFieldValue,
  validateFieldValue,
} from "./field-value-service.js";

// --- Prisma include & result type ---

export const includeOp = {
  operation: {
    select: {
      seqNo: true,
      title: true,
      description: true,
      workCenter: { select: { key: true } },
    },
  },
  assignedTo: { select: { username: true } },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type OpRunWithOp = OperationRunModel & {
  operation: {
    seqNo: number;
    title: string;
    description: string;
    workCenter: { key: string } | null;
  };
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
    workCenter: { key: string } | null;
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
          workCenter: { select: { key: true } },
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

export async function getOpRunStepSummary(opRunId: number) {
  return erpDb.stepRun.findMany({
    where: { operationRunId: opRunId },
    select: {
      step: { select: { seqNo: true, title: true } },
      completed: true,
    },
    orderBy: { step: { seqNo: "asc" } },
  });
}

/**
 * Resolve field reference values for an operation run.
 * Looks up the plan-level field refs, finds the corresponding step runs
 * in the same order run, and returns FieldValueEntry-shaped data
 * compatible with the FieldValueRunList component.
 */
export async function getOpRunFieldRefSummary(
  operationId: number,
  orderRunId: number,
  orderKey: string,
  runNo: number,
): Promise<FieldRefValueSummary[]> {
  // Get field refs from the plan-level operation
  const fieldRefs = await erpDb.operationFieldRef.findMany({
    where: { operationId },
    include: {
      sourceStep: {
        select: {
          id: true,
          seqNo: true,
          title: true,
          multiSet: true,
          operation: { select: { seqNo: true, title: true } },
          fieldSet: {
            select: {
              fields: {
                select: {
                  id: true,
                  seqNo: true,
                  label: true,
                  type: true,
                  multiValue: true,
                  required: true,
                },
                orderBy: { seqNo: "asc" as const },
              },
            },
          },
        },
      },
    },
    orderBy: { seqNo: "asc" },
  });

  if (fieldRefs.length === 0) return [];

  // Collect all source step IDs to batch-fetch their step runs
  const sourceStepIds = fieldRefs.map((r) => r.sourceStep.id);

  // Find the step runs for these source steps in the same order run
  // Include attachments for attachment-type fields
  const stepRuns = await erpDb.stepRun.findMany({
    where: {
      operationRun: { orderRunId },
      stepId: { in: sourceStepIds },
    },
    select: {
      stepId: true,
      fieldRecord: {
        select: {
          fieldValues: {
            select: {
              fieldId: true,
              setIndex: true,
              value: true,
              fieldAttachments: {
                include: {
                  attachment: {
                    select: { id: true, filename: true, fileSize: true },
                  },
                },
              },
            },
            orderBy: { setIndex: "asc" },
          },
        },
      },
    },
  });

  const stepRunMap = new Map(stepRuns.map((sr) => [sr.stepId, sr]));

  return fieldRefs.map((ref) => {
    const sr = stepRunMap.get(ref.sourceStep.id);
    const storedFieldValues = sr?.fieldRecord?.fieldValues ?? [];
    const fields = ref.sourceStep.fieldSet?.fields ?? [];

    // Determine set count
    const maxSetIndex = storedFieldValues.reduce(
      (max, fv) => Math.max(max, fv.setIndex),
      -1,
    );
    const setCount = Math.max(1, maxSetIndex + 1);

    // Build FieldValueEntry-shaped objects for each set × field
    const fieldValues: FieldRefValueSummary["fieldValues"] = [];
    for (let si = 0; si < setCount; si++) {
      for (const field of fields) {
        const stored = storedFieldValues.find(
          (fv) => fv.fieldId === field.id && fv.setIndex === si,
        );
        const value = deserializeFieldValue(
          stored?.value ?? "",
          field.multiValue,
        );
        const setPath = ref.sourceStep.multiSet
          ? `/sets/${si}/fields/${field.seqNo}`
          : `/fields/${field.seqNo}`;
        const stepsHref = `${API_PREFIX}/orders/${orderKey}/runs/${runNo}/ops/${ref.sourceStep.operation.seqNo}/steps/${ref.sourceStep.seqNo}`;
        const attachments =
          field.type === "attachment" && stored
            ? stored.fieldAttachments.map((sfa) => ({
                ...sfa.attachment,
                downloadHref: `${stepsHref}${setPath}/attachments/${sfa.attachment.id}`,
              }))
            : undefined;
        fieldValues.push({
          fieldId: field.id,
          fieldSeqNo: field.seqNo,
          label: field.label,
          type: field.type,
          valueFormat: getValueFormatHint(field.type),
          multiValue: field.multiValue,
          required: field.required,
          setIndex: si,
          value,
          attachments,
          validation: validateFieldValue(
            field.type,
            field.multiValue,
            field.required,
            value,
          ),
        });
      }
    }

    return {
      seqNo: ref.seqNo,
      title: ref.title,
      sourceOpSeqNo: ref.sourceStep.operation.seqNo,
      sourceOpTitle: ref.sourceStep.operation.title,
      sourceStepSeqNo: ref.sourceStep.seqNo,
      sourceStepTitle: ref.sourceStep.title,
      multiSet: ref.sourceStep.multiSet,
      fieldValues,
    };
  });
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
    include: { step: { select: { seqNo: true, title: true } } },
  });
  if (incompleteSteps.length === 0) return null;
  const labels = incompleteSteps.map(
    (s) => `Step ${s.step.seqNo}${s.step.title ? ` "${s.step.title}"` : ""}`,
  );
  return `Cannot complete operation: incomplete steps — ${labels.join(", ")}`;
}

// --- Mutations ---

export async function updateOpRun(
  id: number,
  data: { assignedToId?: number | null },
  userId: number,
): Promise<OpRunWithOp> {
  const updateData: Record<string, unknown> = { updatedById: userId };
  if (data.assignedToId !== undefined)
    updateData.assignedToId = data.assignedToId;

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
