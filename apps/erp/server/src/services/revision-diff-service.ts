import type {
  DependencyDiff,
  FieldDiff,
  OperationDiff,
  PropertyChange,
  RevisionDiffResponse,
  StepDiff,
} from "@naisys/erp-shared";

import erpDb from "../erpDb.js";

// --- Prisma deep include for full revision tree ---

const includeFullTree = {
  operations: {
    orderBy: { seqNo: "asc" as const },
    include: {
      steps: {
        orderBy: { seqNo: "asc" as const },
        include: {
          fieldSet: {
            include: { fields: { orderBy: { seqNo: "asc" as const } } },
          },
        },
      },
      predecessors: {
        include: {
          predecessor: { select: { seqNo: true, title: true } },
        },
      },
    },
  },
};

type RevisionTree = NonNullable<Awaited<ReturnType<typeof getRevisionTree>>>;
type OpTree = RevisionTree["operations"][number];
type StepTree = OpTree["steps"][number];
type FieldTree = NonNullable<StepTree["fieldSet"]>["fields"][number];
type DepTree = OpTree["predecessors"][number];

async function getRevisionTree(orderId: number, revNo: number) {
  return erpDb.orderRevision.findFirst({
    where: { orderId, revNo },
    include: includeFullTree,
  });
}

// --- Comparison helpers ---

function compareProps(pairs: [string, unknown, unknown][]): PropertyChange[] {
  const changes: PropertyChange[] = [];
  for (const [field, from, to] of pairs) {
    if (from !== to) {
      changes.push({
        field,
        from: from as PropertyChange["from"],
        to: to as PropertyChange["to"],
      });
    }
  }
  return changes;
}

function diffFields(
  fromFields: FieldTree[],
  toFields: FieldTree[],
): FieldDiff[] {
  const fromMap = new Map(fromFields.map((f) => [f.seqNo, f]));
  const toMap = new Map(toFields.map((f) => [f.seqNo, f]));
  const allSeqNos = new Set([...fromMap.keys(), ...toMap.keys()]);
  const result: FieldDiff[] = [];

  for (const seqNo of [...allSeqNos].sort((a, b) => a - b)) {
    const from = fromMap.get(seqNo);
    const to = toMap.get(seqNo);

    if (!from && to) {
      result.push({ seqNo, label: to.label, status: "added" });
    } else if (from && !to) {
      result.push({ seqNo, label: from.label, status: "removed" });
    } else if (from && to) {
      const changes = compareProps([
        ["label", from.label, to.label],
        ["type", from.type, to.type],
        ["isArray", from.isArray, to.isArray],
        ["required", from.required, to.required],
      ]);
      result.push({
        seqNo,
        label: to.label,
        status: changes.length > 0 ? "modified" : "unchanged",
        ...(changes.length > 0 ? { changes } : {}),
      });
    }
  }

  return result;
}

function diffSteps(fromSteps: StepTree[], toSteps: StepTree[]): StepDiff[] {
  const fromMap = new Map(fromSteps.map((s) => [s.seqNo, s]));
  const toMap = new Map(toSteps.map((s) => [s.seqNo, s]));
  const allSeqNos = new Set([...fromMap.keys(), ...toMap.keys()]);
  const result: StepDiff[] = [];

  for (const seqNo of [...allSeqNos].sort((a, b) => a - b)) {
    const from = fromMap.get(seqNo);
    const to = toMap.get(seqNo);

    if (!from && to) {
      result.push({ seqNo, title: to.title, status: "added" });
    } else if (from && !to) {
      result.push({ seqNo, title: from.title, status: "removed" });
    } else if (from && to) {
      const changes = compareProps([
        ["title", from.title, to.title],
        ["instructions", from.instructions, to.instructions],
        ["multiSet", from.multiSet, to.multiSet],
      ]);
      const fields = diffFields(
        from.fieldSet?.fields ?? [],
        to.fieldSet?.fields ?? [],
      );
      const hasFieldChanges = fields.some((f) => f.status !== "unchanged");
      const isModified = changes.length > 0 || hasFieldChanges;

      result.push({
        seqNo,
        title: to.title,
        status: isModified ? "modified" : "unchanged",
        ...(changes.length > 0 ? { changes } : {}),
        ...(hasFieldChanges ? { fields } : {}),
      });
    }
  }

  return result;
}

function diffDeps(fromDeps: DepTree[], toDeps: DepTree[]): DependencyDiff[] {
  const fromSet = new Map(
    fromDeps.map((d) => [d.predecessor.seqNo, d.predecessor.title]),
  );
  const toSet = new Map(
    toDeps.map((d) => [d.predecessor.seqNo, d.predecessor.title]),
  );
  const allSeqNos = new Set([...fromSet.keys(), ...toSet.keys()]);
  const result: DependencyDiff[] = [];

  for (const seqNo of [...allSeqNos].sort((a, b) => a - b)) {
    const fromTitle = fromSet.get(seqNo);
    const toTitle = toSet.get(seqNo);

    if (fromTitle === undefined && toTitle !== undefined) {
      result.push({
        predecessorSeqNo: seqNo,
        predecessorTitle: toTitle,
        status: "added",
      });
    } else if (fromTitle !== undefined && toTitle === undefined) {
      result.push({
        predecessorSeqNo: seqNo,
        predecessorTitle: fromTitle,
        status: "removed",
      });
    } else if (fromTitle !== undefined) {
      result.push({
        predecessorSeqNo: seqNo,
        predecessorTitle: toTitle ?? fromTitle,
        status: "unchanged",
      });
    }
  }

  return result;
}

function diffOperations(fromOps: OpTree[], toOps: OpTree[]): OperationDiff[] {
  const fromMap = new Map(fromOps.map((op) => [op.seqNo, op]));
  const toMap = new Map(toOps.map((op) => [op.seqNo, op]));
  const allSeqNos = new Set([...fromMap.keys(), ...toMap.keys()]);
  const result: OperationDiff[] = [];

  for (const seqNo of [...allSeqNos].sort((a, b) => a - b)) {
    const from = fromMap.get(seqNo);
    const to = toMap.get(seqNo);

    if (!from && to) {
      result.push({ seqNo, title: to.title, status: "added" });
    } else if (from && !to) {
      result.push({ seqNo, title: from.title, status: "removed" });
    } else if (from && to) {
      const changes = compareProps([
        ["title", from.title, to.title],
        ["description", from.description, to.description],
      ]);
      const steps = diffSteps(from.steps, to.steps);
      const deps = diffDeps(from.predecessors, to.predecessors);
      const hasStepChanges = steps.some((s) => s.status !== "unchanged");
      const hasDepChanges = deps.some((d) => d.status !== "unchanged");
      const isModified = changes.length > 0 || hasStepChanges || hasDepChanges;

      result.push({
        seqNo,
        title: to.title,
        status: isModified ? "modified" : "unchanged",
        ...(changes.length > 0 ? { changes } : {}),
        ...(hasStepChanges ? { steps } : {}),
        ...(hasDepChanges ? { dependencies: deps } : {}),
      });
    }
  }

  return result;
}

// --- Public API ---

export async function diffRevisions(
  orderId: number,
  fromRevNo: number,
  toRevNo: number,
): Promise<RevisionDiffResponse | null> {
  const [fromRev, toRev] = await Promise.all([
    getRevisionTree(orderId, fromRevNo),
    getRevisionTree(orderId, toRevNo),
  ]);

  if (!fromRev || !toRev) return null;

  const revisionChanges = compareProps([
    ["description", fromRev.description, toRev.description],
  ]);

  return {
    fromRevNo,
    toRevNo,
    revisionChanges,
    operations: diffOperations(fromRev.operations, toRev.operations),
  };
}
