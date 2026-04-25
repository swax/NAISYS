import { expect, type APIRequestContext } from "@playwright/test";

import { erpApiPath, expectJson } from "./erp-api-client";

export interface CreateOrderInput {
  key: string;
  description?: string;
  itemKey?: string;
}

export interface CreatedOrder {
  id: number;
  key: string;
  _links?: { rel: string; href: string }[];
  _actions?: { rel: string }[];
}

export async function createOrder(
  api: APIRequestContext,
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  const res = await api.post(erpApiPath("/orders"), {
    data: {
      description: "e2e test order",
      ...input,
    },
  });
  return expectJson<CreatedOrder>(res, 201);
}

export interface CreateRevisionInput {
  description?: string;
  changeSummary?: string;
}

export interface CreatedRevision {
  id: number;
  revNo: number;
  _actions?: { rel: string }[];
}

export async function createRevision(
  api: APIRequestContext,
  orderKey: string,
  input: CreateRevisionInput = {},
): Promise<CreatedRevision> {
  const res = await api.post(erpApiPath(`/orders/${orderKey}/revs`), {
    data: {
      description: "e2e test revision",
      ...input,
    },
  });
  return expectJson<CreatedRevision>(res, 201);
}

export interface OrderWithRevision {
  order: CreatedOrder;
  revision: CreatedRevision;
}

export async function createOrderWithRevision(
  api: APIRequestContext,
  input: CreateOrderInput,
  revisionInput?: CreateRevisionInput,
): Promise<OrderWithRevision> {
  const order = await createOrder(api, input);
  const revision = await createRevision(api, order.key, revisionInput);
  return { order, revision };
}

export interface CreateOrderRunInput {
  revNo: number;
  priority?: "low" | "normal" | "high" | "critical";
  dueAt?: string;
  releaseNote?: string;
}

export interface CreatedOrderRun {
  id: number;
  runNo: number;
  status: string;
  _links?: { rel: string }[];
  _actions?: { rel: string }[];
}

export async function createOrderRun(
  api: APIRequestContext,
  orderKey: string,
  input: CreateOrderRunInput,
): Promise<CreatedOrderRun> {
  const res = await api.post(erpApiPath(`/orders/${orderKey}/runs`), {
    data: {
      priority: "normal",
      dueAt: "2099-12-31",
      ...input,
    },
  });
  return expectJson<CreatedOrderRun>(res, 201);
}

export interface ExpectAuditEntryInput {
  entityType: string;
  entityId: number;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
}

export async function expectAuditEntry(
  api: APIRequestContext,
  input: ExpectAuditEntryInput,
): Promise<void> {
  const { entityType, entityId, ...match } = input;
  const res = await api.get(
    erpApiPath(`/audit?entityType=${entityType}&entityId=${entityId}`),
  );
  const audit = await expectJson<{ items: Record<string, unknown>[] }>(
    res,
    200,
  );
  expect(audit.items).toEqual(
    expect.arrayContaining([expect.objectContaining(match)]),
  );
}
