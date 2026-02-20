import { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { AuditListResponseSchema, AuditQuerySchema } from "@naisys-erp/shared";
import erpDb from "../erpDb.js";

export default async function auditRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/", {
    schema: {
      description: "Get audit log entries for a given entity",
      tags: ["Audit"],
      querystring: AuditQuerySchema,
      response: {
        200: AuditListResponseSchema,
      },
    },
    handler: async (request) => {
      const { entityType, entityId } = request.query;

      const items = await erpDb.auditLog.findMany({
        where: { entityType, entityId },
        orderBy: { createdAt: "desc" },
      });

      return {
        items: items.map((item) => ({
          id: item.id,
          entityType: item.entityType,
          entityId: item.entityId,
          action: item.action,
          field: item.field,
          oldValue: item.oldValue,
          newValue: item.newValue,
          userId: item.userId,
          createdAt: item.createdAt.toISOString(),
        })),
      };
    },
  });
}
