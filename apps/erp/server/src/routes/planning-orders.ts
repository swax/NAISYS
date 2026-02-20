import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";
import {
  CreatePlanningOrderSchema,
  ErrorResponseSchema,
  PlanningOrderListQuerySchema,
  PlanningOrderListResponseSchema,
  PlanningOrderSchema,
  UpdatePlanningOrderSchema,
} from "@naisys-erp/shared";
import type { HateoasAction, HateoasLink } from "@naisys/common";
import erpDb from "../erpDb.js";
import { sendError } from "../error-handler.js";
import {
  API_PREFIX,
  collectionLink,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import type { PlanningOrderModel } from "../generated/prisma/models/PlanningOrder.js";

function itemLinks(
  resource: string,
  id: number,
  schemaName: string,
): HateoasLink[] {
  return [
    selfLink(`/${resource}/${id}`),
    collectionLink(resource),
    schemaLink(schemaName),
  ];
}

function itemActions(
  resource: string,
  id: number,
  status: string,
): HateoasAction[] {
  const href = `${API_PREFIX}/${resource}/${id}`;
  const actions: HateoasAction[] = [
    {
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdatePlanningOrder`,
    },
  ];

  if (status === "active") {
    actions.push({
      rel: "archive",
      href,
      method: "PUT",
      title: "Archive",
      body: { status: "archived" },
    });
  } else {
    actions.push({
      rel: "activate",
      href,
      method: "PUT",
      title: "Activate",
      body: { status: "active" },
    });
  }

  actions.push({
    rel: "delete",
    href,
    method: "DELETE",
    title: "Delete",
  });

  return actions;
}

function revisionCollectionLink(
  parentResource: string,
  parentId: number,
): HateoasLink {
  return {
    rel: "revisions",
    href: `${API_PREFIX}/${parentResource}/${parentId}/revisions`,
    title: "Revisions",
  };
}

const RESOURCE = "planning/orders";

const IdParamsSchema = z.object({
  id: z.coerce.number().int(),
});

function formatItem(item: PlanningOrderModel) {
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    description: item.description,
    status: item.status,
    createdBy: item.createdById,
    createdAt: item.createdAt.toISOString(),
    updatedBy: item.updatedById,
    updatedAt: item.updatedAt.toISOString(),
    _links: [
      ...itemLinks(RESOURCE, item.id, "PlanningOrder"),
      revisionCollectionLink(RESOURCE, item.id),
    ],
    _actions: itemActions(RESOURCE, item.id, item.status),
  };
}

function formatListItem(item: PlanningOrderModel) {
  const { _actions, ...rest } = formatItem(item);
  return {
    ...rest,
    _links: [selfLink(`/${RESOURCE}/${item.id}`)],
  };
}

export default function planningOrderRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List planning orders with pagination and filtering",
      tags: ["Planning Orders"],
      querystring: PlanningOrderListQuerySchema,
      response: {
        200: PlanningOrderListResponseSchema,
      },
    },
    handler: async (request) => {
      const { page, pageSize, status, search } = request.query;

      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { key: { contains: search } },
          { description: { contains: search } },
        ];
      }

      const [items, total] = await Promise.all([
        erpDb.planningOrder.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        erpDb.planningOrder.count({ where }),
      ]);

      return {
        items: items.map(formatListItem),
        total,
        page,
        pageSize,
        _links: [
          ...paginationLinks(RESOURCE, page, pageSize, total, {
            status,
            search,
          }),
          {
            rel: "create",
            href: `/api/erp/${RESOURCE}`,
            method: "POST",
          },
        ],
      };
    },
  });

  // CREATE
  app.post("/", {
    schema: {
      description: "Create a new planning order",
      tags: ["Planning Orders"],
      body: CreatePlanningOrderSchema,
      response: {
        201: PlanningOrderSchema,
      },
    },
    handler: async (request, reply) => {
      const { key, name, description } = request.body;
      const userId = request.erpUser!.id;

      const item = await erpDb.planningOrder.create({
        data: {
          key,
          name,
          description,
          createdById: userId,
          updatedById: userId,
        },
      });

      reply.status(201);
      return formatItem(item);
    },
  });

  // GET by ID
  app.get("/:id", {
    schema: {
      description: "Get a single planning order by ID",
      tags: ["Planning Orders"],
      params: IdParamsSchema,
      response: {
        200: PlanningOrderSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const item = await erpDb.planningOrder.findUnique({ where: { id } });
      if (!item) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Planning order ${id} not found`,
        );
      }

      return formatItem(item);
    },
  });

  // UPDATE
  app.put("/:id", {
    schema: {
      description: "Update a planning order",
      tags: ["Planning Orders"],
      params: IdParamsSchema,
      body: UpdatePlanningOrderSchema,
      response: {
        200: PlanningOrderSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const data = request.body;
      const userId = request.erpUser!.id;

      const existing = await erpDb.planningOrder.findUnique({
        where: { id },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Planning order ${id} not found`,
        );
      }

      const item = await erpDb.planningOrder.update({
        where: { id },
        data: { ...data, updatedById: userId },
      });

      return formatItem(item);
    },
  });

  // DELETE
  app.delete("/:id", {
    schema: {
      description: "Delete a planning order",
      tags: ["Planning Orders"],
      params: IdParamsSchema,
      response: {
        204: z.void(),
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const existing = await erpDb.planningOrder.findUnique({
        where: { id },
      });
      if (!existing) {
        return sendError(
          reply,
          404,
          "Not Found",
          `Planning order ${id} not found`,
        );
      }

      const revisionCount = await erpDb.planningOrderRevision.count({
        where: { planOrderId: id },
      });
      if (revisionCount > 0) {
        return sendError(
          reply,
          409,
          "Conflict",
          "Cannot delete planning order with existing revisions. Archive it instead.",
        );
      }

      await erpDb.planningOrder.delete({ where: { id } });
      reply.status(204);
    },
  });
}
