import type { HateoasAction } from "@naisys/common";
import {
  CreateOperationRunCommentSchema,
  CreateResponseSchema,
  ErrorResponseSchema,
  OperationRunCommentListResponseSchema,
  OperationRunCommentType,
} from "@naisys/erp-shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import type { ErpUser } from "../auth-middleware.js";
import { requirePermission } from "../auth-middleware.js";
import { notFound } from "../error-handler.js";
import { API_PREFIX, selfLink } from "../hateoas.js";
import {
  mutationResult,
  resolveActions,
  resolveOpRun,
} from "../route-helpers.js";
import {
  type CommentWithUser,
  createComment,
  listComments,
} from "../services/operation-run-comment-service.js";

function commentResource(orderKey: string, runNo: number, seqNo: number) {
  return `orders/${orderKey}/runs/${runNo}/ops/${seqNo}/comments`;
}

function commentListActions(
  orderKey: string,
  runNo: number,
  seqNo: number,
  user: ErpUser | undefined,
): HateoasAction[] {
  return resolveActions(
    [
      {
        rel: "create",
        method: "POST",
        title: "Add Comment",
        schema: `${API_PREFIX}/schemas/CreateOperationRunComment`,
        permission: "order_executor",
      },
    ],
    `${API_PREFIX}/${commentResource(orderKey, runNo, seqNo)}`,
    { user },
  );
}

function formatComment(
  orderKey: string,
  runNo: number,
  seqNo: number,
  comment: CommentWithUser,
) {
  return {
    id: comment.id,
    operationRunId: comment.operationRunId,
    type: comment.type,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    createdBy: comment.createdBy.username,
    _links: [
      selfLink(`/${commentResource(orderKey, runNo, seqNo)}/${comment.id}`),
    ],
  };
}

const CommentParamsSchema = z.object({
  orderKey: z.string(),
  runNo: z.coerce.number().int(),
  seqNo: z.coerce.number().int(),
});

export default function operationRunCommentRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List comments for an operation run",
      tags: ["Operation Run Comments"],
      params: CommentParamsSchema,
      response: {
        200: OperationRunCommentListResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation run not found");
      }

      const items = await listComments(resolved.opRun.id);

      return {
        items: items.map((c) => {
          const { _links, ...rest } = formatComment(orderKey, runNo, seqNo, c);
          return rest;
        }),
        total: items.length,
        _links: [selfLink(`/${commentResource(orderKey, runNo, seqNo)}`)],
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}/${commentResource(orderKey, runNo, seqNo)}/{id}`,
          },
        ],
        _actions: commentListActions(orderKey, runNo, seqNo, request.erpUser),
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Add a comment to an operation run",
      tags: ["Operation Run Comments"],
      params: CommentParamsSchema,
      body: CreateOperationRunCommentSchema,
      response: {
        201: CreateResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preHandler: requirePermission("order_executor"),
    handler: async (request, reply) => {
      const { orderKey, runNo, seqNo } = request.params;
      const { type, body } = request.body;
      const userId = request.erpUser!.id;

      const resolved = await resolveOpRun(orderKey, runNo, seqNo);
      if (!resolved) {
        return notFound(reply, "Operation run not found");
      }

      const comment = await createComment(
        resolved.opRun.id,
        type ?? OperationRunCommentType.note,
        body,
        userId,
      );

      const full = formatComment(orderKey, runNo, seqNo, comment);
      reply.status(201);
      return mutationResult(request, reply, full, {
        id: full.id,
        _links: full._links,
      });
    },
  });
}
