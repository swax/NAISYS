import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  type ActionDef as ActionDefBase,
  permGate,
  resolveActions as resolveActionsBase,
} from "@naisys/common";
import {
  type ErpPermission,
  OperationRunStatus,
  OrderRunStatus,
  RevisionStatus,
} from "@naisys-erp/shared";

import type { ErpUser } from "./auth-middleware.js";
import { hasPermission } from "./auth-middleware.js";
import erpDb from "./erpDb.js";
import { API_PREFIX, schemaLink, selfLink } from "./hateoas.js";

// --- Shared Prisma include for audit user fields ---

export const includeUsers = {
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type WithAuditUsers = {
  createdAt: Date;
  createdBy: { username: string };
  updatedAt: Date;
  updatedBy: { username: string };
};

// --- Formatting helpers ---

export function formatAuditFields(item: WithAuditUsers) {
  return {
    createdAt: item.createdAt.toISOString(),
    createdBy: item.createdBy.username,
    updatedAt: item.updatedAt.toISOString(),
    updatedBy: item.updatedBy.username,
  };
}

export function formatDate(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function calcNextSeqNo(currentMax: number): number {
  return Math.ceil((currentMax + 1) / 10) * 10;
}

// --- HATEOAS helpers ---

export function childItemLinks(
  basePath: string,
  itemKey: string | number,
  collectionTitle: string,
  parentPath: string,
  parentTitle: string,
  schemaName: string,
  parentRel = "parent",
): HateoasLink[] {
  return [
    selfLink(`${basePath}/${itemKey}`),
    {
      rel: "collection",
      href: `${API_PREFIX}${basePath}`,
      title: collectionTitle,
    },
    {
      rel: parentRel,
      href: `${API_PREFIX}${parentPath}`,
      title: parentTitle,
    },
    schemaLink(schemaName),
  ];
}

// --- Declarative action resolver (wraps @naisys/common with ERP permission types) ---

export { permGate };

export interface ActionDef<T> extends Omit<ActionDefBase<T>, "permission"> {
  permission?: ErpPermission;
}

export function resolveActions<T extends { user: ErpUser | undefined }>(
  defs: ActionDef<T>[],
  baseHref: string,
  ctx: T,
): HateoasAction[] {
  return resolveActionsBase(defs, baseHref, ctx, (perm) =>
    hasPermission(ctx.user, perm as ErpPermission),
  );
}

export function draftCrudActions(
  href: string,
  updateSchemaName: string,
  revStatus: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  return resolveActions(
    [
      {
        rel: "update",
        method: "PUT",
        title: "Update",
        schema: `${API_PREFIX}/schemas/${updateSchemaName}`,
        permission: "order_planner",
        disabledWhen: (ctx) =>
          ctx.status !== RevisionStatus.draft
            ? "Can only edit in draft revisions"
            : null,
      },
      {
        rel: "delete",
        method: "DELETE",
        title: "Delete",
        permission: "order_planner",
        statuses: [RevisionStatus.draft],
        hideWithoutPermission: true,
      },
    ],
    href,
    { status: revStatus, user },
  );
}

// --- Status guards (return error message or null) ---

export function checkOrderRunStarted(status: string): string | null {
  return status !== OrderRunStatus.started
    ? `Order run is not started (status: ${status})`
    : null;
}

export function checkOpRunInProgress(status: string): string | null {
  return status !== OperationRunStatus.in_progress
    ? `Operation run is not in_progress (status: ${status})`
    : null;
}

// --- Resolution chains ---

export async function resolveOrder(orderKey: string) {
  return erpDb.order.findUnique({ where: { key: orderKey } });
}

export async function resolveRevision(orderKey: string, revNo: number) {
  const order = await resolveOrder(orderKey);
  if (!order) return null;
  const rev = await erpDb.orderRevision.findFirst({
    where: { orderId: order.id, revNo },
  });
  if (!rev) return null;
  return { order, rev };
}

export async function resolveOperation(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
) {
  const result = await resolveRevision(orderKey, revNo);
  if (!result) return null;
  const operation = await erpDb.operation.findFirst({
    where: { orderRevId: result.rev.id, seqNo: opSeqNo },
  });
  if (!operation) return null;
  return { ...result, operation };
}

export async function resolveStep(
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
) {
  const result = await resolveOperation(orderKey, revNo, opSeqNo);
  if (!result) return null;
  const step = await erpDb.step.findFirst({
    where: { operationId: result.operation.id, seqNo: stepSeqNo },
  });
  if (!step) return null;
  return { ...result, step };
}

export async function resolveOrderRun(orderKey: string, runNo: number) {
  const order = await resolveOrder(orderKey);
  if (!order) return null;
  const run = await erpDb.orderRun.findUnique({
    where: { orderId_runNo: { orderId: order.id, runNo } },
  });
  if (!run) return null;
  return { order, run };
}

export async function resolveOpRun(
  orderKey: string,
  runNo: number,
  seqNo: number,
) {
  const result = await resolveOrderRun(orderKey, runNo);
  if (!result) return null;
  const operation = await erpDb.operation.findFirst({
    where: { orderRevId: result.run.orderRevId, seqNo },
  });
  if (!operation) return null;
  const opRun = await erpDb.operationRun.findUnique({
    where: {
      orderRunId_operationId: {
        orderRunId: result.run.id,
        operationId: operation.id,
      },
    },
  });
  if (!opRun) return null;
  return { ...result, opRun };
}

export async function resolveStepRun(
  orderKey: string,
  runNo: number,
  seqNo: number,
  stepSeqNo: number,
) {
  const result = await resolveOpRun(orderKey, runNo, seqNo);
  if (!result) return null;
  const stepRun = await erpDb.stepRun.findFirst({
    where: { operationRunId: result.opRun.id, step: { seqNo: stepSeqNo } },
  });
  if (!stepRun) return null;
  return { ...result, stepRun };
}
