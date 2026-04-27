import { type APIRequestContext } from "@playwright/test";

import { erpApiPath, expectJson } from "./erp-api-client";

interface OrderRunRef {
  orderKey: string;
  runNo: number;
}

interface OpRunRef extends OrderRunRef {
  seqNo: number;
}

interface StepRunRef extends OpRunRef {
  stepSeqNo: number;
}

export async function startOpRun(
  api: APIRequestContext,
  ref: OpRunRef,
  note?: string,
): Promise<{ status: string }> {
  const res = await api.post(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/start`,
    ),
    { data: { note } },
  );
  return expectJson<{ status: string }>(res, 200);
}

export async function completeOpRun(
  api: APIRequestContext,
  ref: OpRunRef,
  note?: string,
): Promise<{ status: string }> {
  const res = await api.post(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/complete`,
    ),
    { data: { note } },
  );
  return expectJson<{ status: string }>(res, 200);
}

export async function setStepRunFieldValue(
  api: APIRequestContext,
  ref: StepRunRef,
  fieldSeqNo: number,
  value: string | string[],
): Promise<unknown> {
  const res = await api.put(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/steps/${ref.stepSeqNo}/fields/${fieldSeqNo}`,
    ),
    { data: { value } },
  );
  return expectJson<unknown>(res, 200);
}

export async function uploadStepRunAttachment(
  api: APIRequestContext,
  ref: StepRunRef,
  fieldSeqNo: number,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<{ attachmentId: string; filename: string; fileSize: number }> {
  const res = await api.post(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/steps/${ref.stepSeqNo}/fields/${fieldSeqNo}/attachments`,
    ),
    { multipart: { file } },
  );
  return expectJson<{
    attachmentId: string;
    filename: string;
    fileSize: number;
  }>(res, 200);
}

export async function addOpRunComment(
  api: APIRequestContext,
  ref: OpRunRef,
  body: string,
  type?: "note" | "issue" | "feedback",
): Promise<{ id: number }> {
  const res = await api.post(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/comments`,
    ),
    { data: { body, ...(type ? { type } : {}) } },
  );
  return expectJson<{ id: number }>(res, 201);
}

export async function clockIn(
  api: APIRequestContext,
  ref: OpRunRef,
): Promise<{ id: number }> {
  const res = await api.post(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/labor/clock-in`,
    ),
  );
  return expectJson<{ id: number }>(res, 200);
}

export async function clockOut(
  api: APIRequestContext,
  ref: OpRunRef,
): Promise<unknown> {
  const res = await api.post(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/labor/clock-out`,
    ),
    { data: {} },
  );
  return expectJson<unknown>(res, 200);
}

export async function listLaborTickets(
  api: APIRequestContext,
  ref: OpRunRef,
): Promise<{
  items: { id: number; clockOut: string | null }[];
  total: number;
}> {
  const res = await api.get(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/labor`,
    ),
  );
  return expectJson<{
    items: { id: number; clockOut: string | null }[];
    total: number;
  }>(res, 200);
}

export async function completeStepRun(
  api: APIRequestContext,
  ref: StepRunRef,
  note?: string,
): Promise<{ completed: boolean }> {
  const res = await api.post(
    erpApiPath(
      `/orders/${ref.orderKey}/runs/${ref.runNo}/ops/${ref.seqNo}/steps/${ref.stepSeqNo}/complete`,
    ),
    { data: { note } },
  );
  return expectJson<{ completed: boolean }>(res, 200);
}

export async function completeOrderRun(
  api: APIRequestContext,
  ref: OrderRunRef,
  body: {
    instanceKey?: string;
    quantity?: number | null;
    fieldValues?: { fieldSeqNo: number; value: string; setIndex?: number }[];
  },
): Promise<{ status: string }> {
  const res = await api.post(
    erpApiPath(`/orders/${ref.orderKey}/runs/${ref.runNo}/complete`),
    { data: body },
  );
  return expectJson<{ status: string }>(res, 200);
}
