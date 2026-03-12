import type { HateoasAction, HateoasLink } from "@naisys/common";
import { RevisionStatus } from "@naisys-erp/shared";

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

export function draftCrudActions(
  href: string,
  updateSchemaName: string,
  revStatus: string,
  user: ErpUser | undefined,
): HateoasAction[] {
  if (
    !hasPermission(user, "manage_orders") ||
    revStatus !== RevisionStatus.draft
  )
    return [];
  return [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/${updateSchemaName}`,
    },
    {
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
    },
  ];
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

export async function resolveOrderRun(orderKey: string, runId: number) {
  const order = await resolveOrder(orderKey);
  if (!order) return null;
  const run = await erpDb.orderRun.findUnique({ where: { id: runId } });
  if (!run || run.orderId !== order.id) return null;
  return { order, run };
}

export async function resolveOpRun(
  orderKey: string,
  runId: number,
  opRunId: number,
) {
  const result = await resolveOrderRun(orderKey, runId);
  if (!result) return null;
  const opRun = await erpDb.operationRun.findUnique({
    where: { id: opRunId },
  });
  if (!opRun || opRun.orderRunId !== runId) return null;
  return { ...result, opRun };
}
