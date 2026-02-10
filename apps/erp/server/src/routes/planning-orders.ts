import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";
import {
  CreatePlanningOrderSchema,
  PlanningOrderListQuerySchema,
  UpdatePlanningOrderSchema,
} from "@naisys-erp/shared";
import prisma from "../db.js";
import { sendError } from "../error-handler.js";
import {
  itemLinks,
  itemActions,
  paginationLinks,
  revisionCollectionLink,
  selfLink,
} from "../hateoas.js";
import type { PlanningOrderModel } from "../generated/prisma/models/PlanningOrder.js";

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
    createdBy: item.createdBy,
    createdAt: item.createdAt.toISOString(),
    updatedBy: item.updatedBy,
    updatedAt: item.updatedAt.toISOString(),
    _links: [...itemLinks(RESOURCE, item.id, "PlanningOrder"), revisionCollectionLink(RESOURCE, item.id)],
    _actions: itemActions(RESOURCE, item.id, item.status),
  };
}

function formatListItem(item: PlanningOrderModel) {
  return {
    ...formatItem(item),
    _links: [selfLink(`/${RESOURCE}/${item.id}`)],
  };
}

export default async function planningOrderRoutes(
  fastify: FastifyInstance,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LIST
  app.get("/", {
    schema: {
      description: "List planning orders with pagination and filtering",
      tags: ["Planning Orders"],
      querystring: PlanningOrderListQuerySchema,
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
        prisma.planningOrder.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        prisma.planningOrder.count({ where }),
      ]);

      return {
        items: items.map(formatListItem),
        total,
        page,
        pageSize,
        _links: [
          ...paginationLinks(RESOURCE, page, pageSize, total, { status, search }),
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
    },
    handler: async (request, reply) => {
      const { key, name, description, createdBy } = request.body;

      const item = await prisma.planningOrder.create({
        data: {
          key,
          name,
          description,
          createdBy,
          updatedBy: createdBy,
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
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const item = await prisma.planningOrder.findUnique({ where: { id } });
      if (!item) {
        return sendError(reply, 404, "Not Found", `Planning order ${id} not found`);
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
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { updatedBy, ...data } = request.body;

      const existing = await prisma.planningOrder.findUnique({
        where: { id },
      });
      if (!existing) {
        return sendError(reply, 404, "Not Found", `Planning order ${id} not found`);
      }

      const item = await prisma.planningOrder.update({
        where: { id },
        data: { ...data, updatedBy },
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
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const existing = await prisma.planningOrder.findUnique({
        where: { id },
      });
      if (!existing) {
        return sendError(reply, 404, "Not Found", `Planning order ${id} not found`);
      }

      const revisionCount = await prisma.planningOrderRevision.count({
        where: { planOrderId: id },
      });
      if (revisionCount > 0) {
        return sendError(reply, 409, "Conflict", "Cannot delete planning order with existing revisions. Archive it instead.");
      }

      await prisma.planningOrder.delete({ where: { id } });
      reply.status(204);
    },
  });
}
