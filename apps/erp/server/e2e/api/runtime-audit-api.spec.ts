/**
 * ERP runtime + attachments + comments + labor + audit API E2E.
 *
 *  1. Create master data: item with a required field, work center.
 *  2. Create order producing the item, plus a draft revision.
 *  3. Add two operations on the work center; op1 has a step with a
 *     required string field and an optional attachment field.
 *  4. Make op2 depend on op1 and reference op1's step via a field ref.
 *  5. Approve the revision.
 *  6. Cut an order run; assert op1 is pending and op2 is blocked.
 *  7. Start op1 (auto-starts the order run + auto-clocks-in user).
 *  8. Fill the step-run's required string field, then upload an
 *     attachment to the attachment field.
 *  9. Add an operation-run comment (issue type).
 * 10. Clock out + clock in to create a second labor ticket; list
 *     labor and assert two tickets exist.
 * 11. Complete the step run, then complete op1.
 * 12. Assert op2 transitioned to pending (unblocked); start and
 *     complete op2.
 * 13. Complete the order run with item-instance fields supplied;
 *     assert closed status and a minted instance key.
 * 14. Fetch audit entries for the OrderRun, OperationRun, and
 *     OrderRevision; assert the expected events.
 * 15. Fetch the inventory list and the produced item instance;
 *     assert both reflect the new instance.
 */

import { type APIRequestContext } from "@playwright/test";

import { test, expect } from "../fixtures";
import { erpApiPath, expectJson, expectLinks } from "./helpers/erp-api-client";
import {
  addItemField,
  addOperation,
  addOperationDependency,
  addOperationFieldRef,
  addStep,
  addStepField,
  approveRevision,
  createItem,
  createWorkCenter,
} from "./helpers/master-data-fixtures";
import {
  createOrderRun,
  createOrderWithRevision,
  expectAuditEntry,
} from "./helpers/order-fixtures";
import {
  addOpRunComment,
  clockIn,
  clockOut,
  completeOpRun,
  completeOrderRun,
  completeStepRun,
  listLaborTickets,
  setStepRunFieldValue,
  startOpRun,
  uploadStepRunAttachment,
} from "./helpers/runtime-fixtures";

test.describe("Runtime + audit API workflow", () => {
  const stamp = Date.now();
  const itemKey = `e2e-rt-item-${stamp}`;
  const wcKey = `e2e-rt-wc-${stamp}`;
  const orderKey = `e2e-rt-${stamp}`;
  const itemFieldLabel = "Material";
  const stringFieldLabel = "MeasuredValue";
  const attachmentFieldLabel = "Photo";
  const opTitle1 = "Machining";
  const opTitle2 = "Inspection";
  const stepTitle1 = "Cut and Measure";
  const fieldRefTitle = "Machining results";
  const instanceKey = `RUN-${stamp}`;

  let api: APIRequestContext;

  // populated during setup
  let revNo: number;
  let revId: number;
  let runNo: number;
  let runId: number;
  let opRun1Id: number;
  let opRun2Id: number;
  let stringFieldSeqNo: number;
  let attachmentFieldSeqNo: number;
  let itemFieldSeqNo: number;

  test.beforeAll(async ({ authedApi }) => {
    api = authedApi;
  });

  // ── Master data ──────────────────────────────────────────────────

  test("create item with required field and work center", async () => {
    await createItem(api, {
      key: itemKey,
      description: "Widget for runtime e2e",
    });
    const itemField = await addItemField(api, itemKey, {
      label: itemFieldLabel,
      type: "string",
      required: true,
    });
    itemFieldSeqNo = itemField.seqNo;

    await createWorkCenter(api, {
      key: wcKey,
      description: "WC for runtime e2e",
    });
  });

  // ── Order + revision + ops + step + fields ──────────────────────

  test("create order producing item with a fresh revision", async () => {
    const setup = await createOrderWithRevision(
      api,
      {
        key: orderKey,
        description: "Runtime e2e order",
        itemKey,
      },
      { description: "Initial revision" },
    );
    expect(setup.order.key).toBe(orderKey);
    revNo = setup.revision.revNo;
    revId = setup.revision.id;
  });

  test("add operations, step, and step fields", async () => {
    const op1 = await addOperation(api, orderKey, revNo, {
      title: opTitle1,
      workCenterKey: wcKey,
    });
    expect(op1.seqNo).toBe(10);

    // Pass an empty predecessorSeqNos to skip the implicit "depends on
    // previous op" auto-link — we add the dependency explicitly below to
    // exercise the operation-dependencies route.
    const op2 = await addOperation(api, orderKey, revNo, {
      title: opTitle2,
      workCenterKey: wcKey,
      predecessorSeqNos: [],
    });
    expect(op2.seqNo).toBe(20);

    const step = await addStep(api, orderKey, revNo, op1.seqNo, {
      title: stepTitle1,
      instructions: "Cut to spec and measure",
    });
    expect(step.seqNo).toBe(10);

    const strField = await addStepField(
      api,
      orderKey,
      revNo,
      op1.seqNo,
      step.seqNo,
      {
        label: stringFieldLabel,
        type: "string",
        required: true,
      },
    );
    stringFieldSeqNo = strField.seqNo;

    const attField = await addStepField(
      api,
      orderKey,
      revNo,
      op1.seqNo,
      step.seqNo,
      {
        label: attachmentFieldLabel,
        type: "attachment",
        required: false,
      },
    );
    attachmentFieldSeqNo = attField.seqNo;
  });

  test("add operation dependency: op2 depends on op1", async () => {
    const dep = await addOperationDependency(api, orderKey, revNo, 20, 10);
    expect(dep.id).toBeDefined();
  });

  test("add operation field reference: op2 references op1.step1", async () => {
    const ref = await addOperationFieldRef(api, orderKey, revNo, 20, {
      title: fieldRefTitle,
      sourceOpSeqNo: 10,
      sourceStepSeqNo: 10,
    });
    expect(ref.seqNo).toBeGreaterThan(0);
  });

  test("approve the revision", async () => {
    const result = await approveRevision(api, orderKey, revNo);
    expect(result.status).toBe("approved");
  });

  // ── Cut and start order run ─────────────────────────────────────

  test("cut an order run", async () => {
    const run = await createOrderRun(api, orderKey, {
      revNo,
      priority: "high",
      dueAt: "2099-12-31",
      releaseNote: "Runtime e2e run",
    });
    expect(run.runNo).toBe(1);
    runNo = run.runNo;
    runId = run.id;
  });

  test("op1 is pending, op2 is blocked after cut", async () => {
    const res = await api.get(
      erpApiPath(`/orders/${orderKey}/runs/${runNo}/ops`),
    );
    const body = await expectJson<{
      items: { id: number; seqNo: number; status: string }[];
    }>(res, 200);
    const op1 = body.items.find((i) => i.seqNo === 10)!;
    const op2 = body.items.find((i) => i.seqNo === 20)!;
    expect(op1.status).toBe("pending");
    expect(op2.status).toBe("blocked");
    opRun1Id = op1.id;
    opRun2Id = op2.id;
  });

  // ── Runtime: op1 ─────────────────────────────────────────────────

  test("start op1 (auto-starts order run + clocks user in)", async () => {
    const result = await startOpRun(
      api,
      { orderKey, runNo, seqNo: 10 },
      "Beginning machining",
    );
    expect(result.status).toBe("in_progress");

    // Order run also auto-transitioned released → started
    const orderRunRes = await api.get(
      erpApiPath(`/orders/${orderKey}/runs/${runNo}`),
    );
    const orderRun = await expectJson<{ status: string }>(orderRunRes, 200);
    expect(orderRun.status).toBe("started");
  });

  test("fill step-run required string field", async () => {
    await setStepRunFieldValue(
      api,
      { orderKey, runNo, seqNo: 10, stepSeqNo: 10 },
      stringFieldSeqNo,
      "42.7mm",
    );

    const listRes = await api.get(
      erpApiPath(`/orders/${orderKey}/runs/${runNo}/ops/10/steps/10/fields`),
    );
    const listBody = await expectJson<{
      items: { fieldSeqNo: number; value: string | string[] }[];
    }>(listRes, 200);
    const stored = listBody.items.find(
      (i) => i.fieldSeqNo === stringFieldSeqNo,
    );
    expect(stored?.value).toBe("42.7mm");
  });

  test("upload attachment to step-run attachment field", async () => {
    const buffer = Buffer.from("fake png bytes for e2e attachment");
    const upload = await uploadStepRunAttachment(
      api,
      { orderKey, runNo, seqNo: 10, stepSeqNo: 10 },
      attachmentFieldSeqNo,
      { name: "measurement.txt", mimeType: "text/plain", buffer },
    );
    expect(upload.attachmentId).toBeTruthy();
    expect(upload.fileSize).toBe(buffer.length);
  });

  test("add operation-run comment", async () => {
    const comment = await addOpRunComment(
      api,
      { orderKey, runNo, seqNo: 10 },
      "Found a small chip on the workpiece — flagging for review",
      "issue",
    );
    expect(comment.id).toBeGreaterThan(0);

    const res = await api.get(
      erpApiPath(`/orders/${orderKey}/runs/${runNo}/ops/10/comments`),
    );
    const body = await expectJson<{
      items: { id: number; type: string; body: string }[];
      total: number;
    }>(res, 200);
    expect(body.total).toBe(1);
    expect(body.items[0].type).toBe("issue");
  });

  test("clock out + clock in produces a second labor ticket", async () => {
    await clockOut(api, { orderKey, runNo, seqNo: 10 });
    await clockIn(api, { orderKey, runNo, seqNo: 10 });

    const tickets = await listLaborTickets(api, { orderKey, runNo, seqNo: 10 });
    expect(tickets.total).toBe(2);
    // Exactly one open ticket after the second clock-in
    const open = tickets.items.filter((t) => t.clockOut === null);
    expect(open).toHaveLength(1);
  });

  test("complete the step run", async () => {
    const result = await completeStepRun(
      api,
      { orderKey, runNo, seqNo: 10, stepSeqNo: 10 },
      "Step done",
    );
    expect(result.completed).toBe(true);
  });

  test("complete op1", async () => {
    const result = await completeOpRun(
      api,
      { orderKey, runNo, seqNo: 10 },
      "Op1 done",
    );
    expect(result.status).toBe("completed");
  });

  // ── Runtime: op2 unblocks ────────────────────────────────────────

  test("op2 transitioned to pending (unblocked)", async () => {
    const res = await api.get(
      erpApiPath(`/orders/${orderKey}/runs/${runNo}/ops/20`),
    );
    const body = await expectJson<{ status: string }>(res, 200);
    expect(body.status).toBe("pending");
  });

  test("start and complete op2", async () => {
    const start = await startOpRun(api, { orderKey, runNo, seqNo: 20 });
    expect(start.status).toBe("in_progress");

    const done = await completeOpRun(api, { orderKey, runNo, seqNo: 20 });
    expect(done.status).toBe("completed");
  });

  // ── Order-run completion mints item instance ────────────────────

  test("complete order run into a new item instance", async () => {
    const result = await completeOrderRun(
      api,
      { orderKey, runNo },
      {
        instanceKey,
        quantity: 1,
        fieldValues: [{ fieldSeqNo: itemFieldSeqNo, value: "Aluminum" }],
      },
    );
    expect(result.status).toBe("closed");

    const runRes = await api.get(
      erpApiPath(`/orders/${orderKey}/runs/${runNo}`),
    );
    const run = await expectJson<{
      status: string;
      instanceId: number | null;
      instanceKey: string | null;
    }>(runRes, 200);
    expect(run.status).toBe("closed");
    expect(run.instanceKey).toBe(instanceKey);
    expect(run.instanceId).toBeGreaterThan(0);
    expectLinks(run, ["itemInstance"]);
  });

  // ── Audit assertions ─────────────────────────────────────────────

  test("audit log captured the key transitions", async () => {
    await expectAuditEntry(api, {
      entityType: "OrderRevision",
      entityId: revId,
      action: "approve",
      field: "status",
      oldValue: "draft",
      newValue: "approved",
    });
    await expectAuditEntry(api, {
      entityType: "OrderRun",
      entityId: runId,
      action: "start",
      field: "status",
      oldValue: "released",
      newValue: "started",
    });
    await expectAuditEntry(api, {
      entityType: "OperationRun",
      entityId: opRun1Id,
      action: "start",
      field: "status",
      oldValue: "pending",
      newValue: "in_progress",
    });
    await expectAuditEntry(api, {
      entityType: "OperationRun",
      entityId: opRun1Id,
      action: "complete",
      field: "status",
      oldValue: "in_progress",
      newValue: "completed",
    });
    await expectAuditEntry(api, {
      entityType: "OperationRun",
      entityId: opRun2Id,
      action: "complete",
      field: "status",
      oldValue: "in_progress",
      newValue: "completed",
    });
    await expectAuditEntry(api, {
      entityType: "OrderRun",
      entityId: runId,
      action: "complete",
      field: "status",
      oldValue: "started",
      newValue: "closed",
    });
  });

  // ── Inventory + item instance ───────────────────────────────────

  test("inventory list includes the produced instance", async () => {
    const res = await api.get(
      erpApiPath(`/inventory?search=${encodeURIComponent(instanceKey)}`),
    );
    const body = await expectJson<{
      items: { key: string; itemKey: string; orderKey: string | null }[];
      total: number;
    }>(res, 200);
    expect(body.total).toBeGreaterThanOrEqual(1);
    const match = body.items.find((i) => i.key === instanceKey);
    expect(match).toBeDefined();
    expect(match!.itemKey).toBe(itemKey);
    expect(match!.orderKey).toBe(orderKey);
  });

  test("fetch the produced item instance and assert its fields", async () => {
    // We don't have the instance id directly, so look it up via the run
    const runRes = await api.get(
      erpApiPath(`/orders/${orderKey}/runs/${runNo}`),
    );
    const run = await expectJson<{ instanceId: number }>(runRes, 200);

    const res = await api.get(
      erpApiPath(`/items/${itemKey}/instances/${run.instanceId}`),
    );
    const body = await expectJson<{
      key: string;
      quantity: number | null;
      fieldValues: { fieldSeqNo: number; value: string | string[] }[];
    }>(res, 200);
    expect(body.key).toBe(instanceKey);
    expect(body.quantity).toBe(1);
    const matFv = body.fieldValues.find(
      (fv) => fv.fieldSeqNo === itemFieldSeqNo,
    );
    expect(matFv?.value).toBe("Aluminum");
  });
});
