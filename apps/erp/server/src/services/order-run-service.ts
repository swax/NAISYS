import {
  OperationRunStatus as OperationRunStatusValues,
  type OrderRunPriority,
  type OrderRunStatus,
  OrderRunStatus as OrderRunStatusValues,
} from "@naisys/erp-shared";

import { writeAuditEntry } from "../audit.js";
import erpDb from "../erpDb.js";
import type { OrderRunModel } from "../generated/prisma/models/OrderRun.js";
import {
  deserializeFieldValue,
  upsertFieldValue,
  validateFieldSet,
} from "./field-value-service.js";

// --- Prisma include & result type ---

export const includeRev = {
  orderRev: { select: { revNo: true } },
  order: { select: { item: { select: { key: true } } } },
  itemInstances: { select: { id: true, key: true }, take: 1 },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type OrderRunWithRev = OrderRunModel & {
  orderRev: { revNo: number };
  order: { item: { key: string } | null };
  itemInstances: { id: number; key: string }[];
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

export async function getOrderRunOpSummary(orderRunId: number) {
  return erpDb.operationRun.findMany({
    where: { orderRunId },
    select: {
      operation: { select: { seqNo: true, title: true } },
      status: true,
    },
    orderBy: { operation: { seqNo: "asc" } },
  });
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

export async function sumOpRunCosts(orderRunId: number): Promise<number> {
  const result = await erpDb.operationRun.aggregate({
    where: { orderRunId },
    _sum: { cost: true },
  });
  return Math.round((result._sum.cost ?? 0) * 100) / 100;
}

// --- Mutations ---

export async function createOrderRun(
  orderId: number,
  orderRevId: number,
  data: {
    priority: OrderRunPriority;
    dueAt?: string | null;
    releaseNote?: string | null;
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
        dueAt: data.dueAt ?? null,
        releaseNote: data.releaseNote ?? null,
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

    // Create OperationRun -> StepRun -> FieldRecord -> FieldValue rows
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

        const fields = step.fieldSet?.fields ?? [];
        if (fields.length > 0 && step.fieldSetId) {
          const fieldRecord = await erpTx.fieldRecord.create({
            data: { fieldSetId: step.fieldSetId, createdById: userId },
          });
          await erpTx.stepRun.update({
            where: { id: stepRun.id },
            data: { fieldRecordId: fieldRecord.id },
          });
          for (const field of fields) {
            await erpTx.fieldValue.create({
              data: {
                fieldRecordId: fieldRecord.id,
                fieldId: field.id,
                value: "",
                createdById: userId,
                updatedById: userId,
              },
            });
          }
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
    releaseNote?: string | null;
    dueAt?: string | null;
  },
  userId: number,
): Promise<OrderRunWithRev> {
  const updateData: Record<string, unknown> = { updatedById: userId };
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.releaseNote !== undefined) updateData.releaseNote = data.releaseNote;
  if (data.dueAt !== undefined) updateData.dueAt = data.dueAt;

  return erpDb.orderRun.update({
    where: { id },
    data: updateData,
    include: includeRev,
  });
}

export async function deleteOrderRun(id: number): Promise<void> {
  await erpDb.$transaction(async (tx) => {
    const opRuns = await tx.operationRun.findMany({
      where: { orderRunId: id },
      select: { id: true },
    });
    const opRunIds = opRuns.map((r) => r.id);

    if (opRunIds.length > 0) {
      const stepRuns = await tx.stepRun.findMany({
        where: { operationRunId: { in: opRunIds } },
        select: { fieldRecordId: true },
      });
      const fieldRecordIds = stepRuns
        .map((s) => s.fieldRecordId)
        .filter((id): id is number => id !== null);

      if (fieldRecordIds.length > 0) {
        await tx.fieldValue.deleteMany({
          where: { fieldRecordId: { in: fieldRecordIds } },
        });
      }
      await tx.stepRun.deleteMany({
        where: { operationRunId: { in: opRunIds } },
      });
      if (fieldRecordIds.length > 0) {
        await tx.fieldRecord.deleteMany({
          where: { id: { in: fieldRecordIds } },
        });
      }
      await tx.operationRun.deleteMany({ where: { orderRunId: id } });
    }

    await tx.orderRun.delete({ where: { id } });
  });
}

export async function transitionStatus(
  id: number,
  action: string,
  fromStatus: OrderRunStatus,
  toStatus: OrderRunStatus,
  userId: number,
  extraData?: Record<string, unknown>,
): Promise<OrderRunWithRev> {
  return erpDb.$transaction(async (erpTx) => {
    const updated = await erpTx.orderRun.update({
      where: { id },
      data: { status: toStatus, updatedById: userId, ...extraData },
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

export async function findLatestApprovedRevision(orderId: number) {
  return erpDb.orderRevision.findFirst({
    where: { orderId, status: "approved" },
    orderBy: { revNo: "desc" },
  });
}

export function getReopenTarget(currentStatus: OrderRunStatus): OrderRunStatus {
  return currentStatus === OrderRunStatusValues.closed
    ? OrderRunStatusValues.started
    : OrderRunStatusValues.released;
}

// --- Completion ---

/**
 * Auto-generate an instance key by finding the last instance for the item,
 * parsing its key as a number, and incrementing. Returns the generated key
 * or an error string if the last key is not numeric.
 */
async function autoGenerateInstanceKey(
  erpTx: Parameters<Parameters<typeof erpDb.$transaction>[0]>[0],
  itemId: number,
): Promise<{ key: string } | { error: string }> {
  const last = await erpTx.itemInstance.findFirst({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    select: { key: true },
  });
  if (!last) return { key: "1" };
  const num = Number(last.key);
  if (isNaN(num)) {
    return {
      error: `Cannot auto-generate instance key: last key "${last.key}" is not numeric. Please provide a key manually.`,
    };
  }
  return { key: String(Math.floor(num) + 1) };
}

export type CompleteOrderRunResult =
  | { run: OrderRunWithRev; error?: undefined; status?: undefined }
  | {
      error: string;
      status: 400 | 422;
      missingFields?: string[];
      run?: undefined;
    };

export async function completeOrderRun(
  orderRunId: number,
  orderId: number,
  data: {
    instanceKey?: string;
    quantity?: number | null;
    fieldValues?: { fieldSeqNo: number; value: string; setIndex?: number }[];
  },
  userId: number,
): Promise<CompleteOrderRunResult> {
  return erpDb.$transaction(async (erpTx) => {
    // Load the order with its item and full item field definitions.
    const order = await erpTx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        item: {
          select: {
            id: true,
            fieldSetId: true,
            fieldSet: {
              select: {
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
      },
    });

    if (!order.item) {
      return {
        error: "Order has no item assigned — cannot complete",
        status: 422,
      };
    }

    const itemFields = order.item.fieldSet?.fields ?? [];
    const fieldsBySeqNo = new Map(itemFields.map((f) => [f.seqNo, f]));
    const fieldsById = new Map(itemFields.map((f) => [f.id, f]));

    // Validate caller-supplied fieldSeqNos exist on the item.
    const callerValues = data.fieldValues ?? [];
    for (const fv of callerValues) {
      if (!fieldsBySeqNo.has(fv.fieldSeqNo)) {
        return {
          error: `Unknown item field seqNo ${fv.fieldSeqNo} — item has no field with that sequence number`,
          status: 400,
        };
      }
    }

    // Resolve caller-supplied values into a map keyed by (fieldId, setIndex).
    type ResolvedValue = { fieldId: number; value: string; setIndex: number };
    const resolved = new Map<string, ResolvedValue>();
    const keyOf = (fieldId: number, setIndex: number) =>
      `${fieldId}:${setIndex}`;

    for (const fv of callerValues) {
      const def = fieldsBySeqNo.get(fv.fieldSeqNo)!;
      const setIndex = fv.setIndex ?? 0;
      resolved.set(keyOf(def.id, setIndex), {
        fieldId: def.id,
        value: fv.value,
        setIndex,
      });
    }

    // Validate all item fields against caller-supplied values at setIndex 0.
    // `fieldValues[]` on CompleteOrderRun is flat (no multi-set support), so
    // we only validate set 0. Flags both missing-required and type-invalid.
    const failures = validateFieldSet(itemFields, [0], (fieldId, setIndex) => {
      const def = fieldsById.get(fieldId)!;
      const r = resolved.get(keyOf(fieldId, setIndex));
      if (r) return deserializeFieldValue(r.value, def.isArray);
      return def.isArray ? [] : "";
    });
    if (failures.length > 0) {
      return {
        error: `Cannot complete order run: ${failures
          .map((f) => `${f.label} — ${f.error}`)
          .join("; ")}. Provide values via fieldValues[] using fieldSeqNo.`,
        status: 400,
        missingFields: failures.map((f) => f.label),
      };
    }

    // Determine instance key
    let instanceKey = data.instanceKey;
    if (!instanceKey) {
      const result = await autoGenerateInstanceKey(erpTx, order.item.id);
      if ("error" in result) return { error: result.error, status: 422 };
      instanceKey = result.key;
    }

    // Check for duplicate key
    const existing = await erpTx.itemInstance.findUnique({
      where: { itemId_key: { itemId: order.item.id, key: instanceKey } },
    });
    if (existing) {
      return {
        error: `Instance key "${instanceKey}" already exists for this item`,
        status: 422,
      };
    }

    // Create the item instance
    const instance = await erpTx.itemInstance.create({
      data: {
        itemId: order.item.id,
        orderRunId: orderRunId,
        key: instanceKey,
        quantity: data.quantity ?? null,
        createdById: userId,
        updatedById: userId,
      },
    });

    // Create field record and field values if we have any to write.
    if (order.item.fieldSetId && resolved.size > 0) {
      const fieldRecord = await erpTx.fieldRecord.create({
        data: {
          fieldSetId: order.item.fieldSetId,
          createdById: userId,
        },
      });

      await erpTx.itemInstance.update({
        where: { id: instance.id },
        data: { fieldRecordId: fieldRecord.id },
      });

      for (const fv of resolved.values()) {
        await upsertFieldValue(
          fieldRecord.id,
          fv.fieldId,
          fv.setIndex,
          fv.value,
          userId,
          erpTx,
        );
      }
    }

    // Sum operation run costs and transition run to closed
    const costResult = await erpTx.operationRun.aggregate({
      where: { orderRunId },
      _sum: { cost: true },
    });
    const cost = Math.round((costResult._sum.cost ?? 0) * 100) / 100;

    const updated = await erpTx.orderRun.update({
      where: { id: orderRunId },
      data: {
        status: OrderRunStatusValues.closed,
        cost,
        updatedById: userId,
      },
      include: includeRev,
    });

    await writeAuditEntry(
      erpTx,
      "OrderRun",
      orderRunId,
      "complete",
      "status",
      OrderRunStatusValues.started,
      OrderRunStatusValues.closed,
      userId,
    );

    return { run: updated };
  });
}
