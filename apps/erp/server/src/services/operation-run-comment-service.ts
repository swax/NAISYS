import type { OperationRunCommentType } from "@naisys/erp-shared";

import erpDb from "../erpDb.js";
import type { OperationRunCommentModel } from "../generated/prisma/models/OperationRunComment.js";

// --- Prisma include & result type ---

export const includeComment = {
  createdBy: { select: { username: true } },
} as const;

export type CommentWithUser = OperationRunCommentModel & {
  createdBy: { username: string };
};

// --- Lookups ---

export async function listComments(
  operationRunId: number,
): Promise<CommentWithUser[]> {
  return erpDb.operationRunComment.findMany({
    where: { operationRunId },
    include: includeComment,
    orderBy: { createdAt: "asc" },
  });
}

// --- Mutations ---

export async function createComment(
  operationRunId: number,
  type: OperationRunCommentType,
  body: string,
  userId: number,
): Promise<CommentWithUser> {
  return erpDb.operationRunComment.create({
    data: {
      operationRunId,
      type,
      body,
      createdById: userId,
    },
    include: includeComment,
  });
}
