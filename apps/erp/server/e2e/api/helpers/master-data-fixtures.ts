import { type APIRequestContext } from "@playwright/test";

import { erpApiPath, expectJson } from "./erp-api-client";

interface CreatedKey {
  id: number;
  key: string;
}

interface CreatedSeq {
  id: number;
  seqNo: number;
}

export async function createItem(
  api: APIRequestContext,
  input: { key: string; description?: string },
): Promise<CreatedKey> {
  const res = await api.post(erpApiPath("/items"), {
    data: { description: "e2e item", ...input },
  });
  return expectJson<CreatedKey>(res, 201);
}

export async function addItemField(
  api: APIRequestContext,
  itemKey: string,
  input: {
    label: string;
    type?: "string" | "number" | "date" | "datetime" | "yesNo" | "checkbox";
    required?: boolean;
    isArray?: boolean;
  },
): Promise<CreatedSeq> {
  const res = await api.post(erpApiPath(`/items/${itemKey}/fields`), {
    data: { type: "string", ...input },
  });
  return expectJson<CreatedSeq>(res, 201);
}

export async function createWorkCenter(
  api: APIRequestContext,
  input: { key: string; description?: string },
): Promise<CreatedKey> {
  const res = await api.post(erpApiPath("/work-centers"), {
    data: { description: "e2e work center", ...input },
  });
  return expectJson<CreatedKey>(res, 201);
}

export async function addOperation(
  api: APIRequestContext,
  orderKey: string,
  revNo: number,
  input: {
    title: string;
    description?: string;
    workCenterKey?: string;
    predecessorSeqNos?: number[];
  },
): Promise<CreatedSeq> {
  const res = await api.post(
    erpApiPath(`/orders/${orderKey}/revs/${revNo}/ops`),
    { data: input },
  );
  return expectJson<CreatedSeq>(res, 201);
}

export async function addStep(
  api: APIRequestContext,
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  input: {
    title: string;
    instructions?: string;
    multiSet?: boolean;
  },
): Promise<CreatedSeq> {
  const res = await api.post(
    erpApiPath(`/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps`),
    { data: input },
  );
  return expectJson<CreatedSeq>(res, 201);
}

export async function addStepField(
  api: APIRequestContext,
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  stepSeqNo: number,
  input: {
    label: string;
    type?:
      | "string"
      | "number"
      | "date"
      | "datetime"
      | "yesNo"
      | "checkbox"
      | "attachment";
    required?: boolean;
    isArray?: boolean;
  },
): Promise<CreatedSeq> {
  const res = await api.post(
    erpApiPath(
      `/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/steps/${stepSeqNo}/fields`,
    ),
    { data: { type: "string", ...input } },
  );
  return expectJson<CreatedSeq>(res, 201);
}

export async function addOperationDependency(
  api: APIRequestContext,
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  predecessorSeqNo: number,
): Promise<{ id: number }> {
  const res = await api.post(
    erpApiPath(`/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/deps`),
    { data: { predecessorSeqNo } },
  );
  return expectJson<{ id: number }>(res, 201);
}

export async function addOperationFieldRef(
  api: APIRequestContext,
  orderKey: string,
  revNo: number,
  opSeqNo: number,
  input: {
    title: string;
    sourceOpSeqNo: number;
    sourceStepSeqNo: number;
  },
): Promise<CreatedSeq> {
  const res = await api.post(
    erpApiPath(`/orders/${orderKey}/revs/${revNo}/ops/${opSeqNo}/field-refs`),
    { data: input },
  );
  return expectJson<CreatedSeq>(res, 201);
}

export async function approveRevision(
  api: APIRequestContext,
  orderKey: string,
  revNo: number,
): Promise<{ status: string }> {
  const res = await api.post(
    erpApiPath(`/orders/${orderKey}/revs/${revNo}/approve`),
  );
  return expectJson<{ status: string }>(res, 200);
}
