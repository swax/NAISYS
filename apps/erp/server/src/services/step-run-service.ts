import erpDb from "../erpDb.js";

// --- Prisma include & result type ---

export const includeStep = {
  step: {
    select: {
      seqNo: true,
      title: true,
      instructions: true,
      multiSet: true,
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
  fieldRecord: {
    include: {
      fieldValues: {
        select: {
          id: true,
          fieldId: true,
          setIndex: true,
          value: true,
          fieldAttachments: {
            select: {
              attachment: {
                select: { id: true, filename: true, fileSize: true },
              },
            },
          },
        },
        orderBy: { setIndex: "asc" as const },
      },
    },
  },
  createdBy: { select: { username: true } },
  updatedBy: { select: { username: true } },
} as const;

export type StepRunWithStep = {
  id: number;
  operationRunId: number;
  stepId: number;
  completed: boolean;
  completionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  step: {
    seqNo: number;
    title: string;
    instructions: string;
    multiSet: boolean;
    fieldSet: {
      fields: {
        id: number;
        seqNo: number;
        label: string;
        type: string;
        multiValue: boolean;
        required: boolean;
      }[];
    } | null;
  };
  fieldRecordId: number | null;
  fieldRecord: {
    id: number;
    fieldValues: {
      id: number;
      fieldId: number;
      setIndex: number;
      value: string;
      fieldAttachments: {
        attachment: { id: number; filename: string; fileSize: number };
      }[];
    }[];
  } | null;
  createdBy: { username: string };
  updatedBy: { username: string };
};

// --- Lookups ---

export async function listStepRuns(
  opRunId: number,
): Promise<StepRunWithStep[]> {
  return erpDb.stepRun.findMany({
    where: { operationRunId: opRunId },
    include: includeStep,
    orderBy: { step: { seqNo: "asc" } },
  });
}

export async function getStepRun(id: number): Promise<StepRunWithStep | null> {
  return erpDb.stepRun.findUnique({
    where: { id },
    include: includeStep,
  });
}

export async function findExisting(id: number, opRunId: number) {
  const existing = await erpDb.stepRun.findUnique({
    where: { id },
    include: includeStep,
  });
  if (!existing || existing.operationRunId !== opRunId) return null;
  return existing;
}

// --- Mutations ---

export async function updateStepRun(
  id: number,
  completed: boolean | undefined,
  completionNote: string | undefined,
  userId: number,
): Promise<StepRunWithStep> {
  if (completed !== undefined) {
    await erpDb.stepRun.update({
      where: { id },
      data: {
        completed,
        completionNote: completed ? (completionNote ?? null) : null,
        updatedById: userId,
      },
    });
  }

  return erpDb.stepRun.findUniqueOrThrow({
    where: { id },
    include: includeStep,
  });
}
