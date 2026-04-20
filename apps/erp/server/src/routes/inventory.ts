import type { HateoasActionTemplate } from "@naisys/common";
import {
  InventoryListQuerySchema,
  InventoryListResponseSchema,
} from "@naisys/erp-shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import type { ErpUser } from "../auth-middleware.js";
import { hasPermission } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { API_PREFIX, paginationLinks } from "../hateoas.js";

function buildInventoryActionTemplates(
  user: ErpUser | undefined,
): HateoasActionTemplate[] {
  const templates: HateoasActionTemplate[] = [
    {
      rel: "viewInstance",
      hrefTemplate: `${API_PREFIX}/items/{itemKey}/instances/{id}`,
      method: "GET",
      title: "View Instance",
    },
  ];
  if (hasPermission(user, "item_manager")) {
    templates.push({
      rel: "update-field-value",
      hrefTemplate: `${API_PREFIX}/items/{itemKey}/instances/{id}/fields/{fieldSeqNo}`,
      method: "PUT",
      title: "Update Field Value (implicit set 0)",
      schema: `${API_PREFIX}/schemas/UpdateFieldValue`,
      body: { value: "" },
    });
    templates.push({
      rel: "update-set-field-value",
      hrefTemplate: `${API_PREFIX}/items/{itemKey}/instances/{id}/sets/{setIndex}/fields/{fieldSeqNo}`,
      method: "PUT",
      title: "Update Field Value (explicit set index)",
      schema: `${API_PREFIX}/schemas/UpdateFieldValue`,
      body: { value: "" },
    });
  }
  return templates;
}

export default function inventoryRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", {
    schema: {
      description: "List all item instances across all items (inventory view)",
      tags: ["Inventory"],
      querystring: InventoryListQuerySchema,
      response: {
        200: InventoryListResponseSchema,
      },
    },
    handler: async (request) => {
      const { page, pageSize, search } = request.query;

      const where: Record<string, unknown> = {};

      if (search) {
        where.OR = [
          { key: { contains: search } },
          { item: { key: { contains: search } } },
        ];
      }

      const [instances, total] = await Promise.all([
        erpDb.itemInstance.findMany({
          where,
          include: {
            item: { select: { key: true } },
            orderRun: {
              select: {
                runNo: true,
                order: { select: { key: true } },
              },
            },
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: "desc" },
        }),
        erpDb.itemInstance.count({ where }),
      ]);

      return {
        items: instances.map((inst) => ({
          id: inst.id,
          itemKey: inst.item.key,
          key: inst.key,
          quantity: inst.quantity,
          orderKey: inst.orderRun?.order.key ?? null,
          orderRunNo: inst.orderRun?.runNo ?? null,
          createdAt: inst.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        _links: paginationLinks("inventory", page, pageSize, total, {
          search,
        }),
        _actionTemplates: buildInventoryActionTemplates(request.erpUser),
      };
    },
  });
}
