import { z } from "zod/v4";
import { FastifyInstance } from "fastify";
import { schemaRegistry } from "../schema-registry.js";

export default async function schemaRoutes(fastify: FastifyInstance) {
  // List all available schema names
  fastify.get("/", {
    schema: {
      description: "List all available schema names",
      tags: ["Discovery"],
    },
    handler: async () => {
      return { schemas: Object.keys(schemaRegistry) };
    },
  });

  // Get a single schema by name
  fastify.get("/:schemaName", {
    schema: {
      description: "Get a JSON Schema by name",
      tags: ["Discovery"],
    },
    handler: async (request, reply) => {
      const { schemaName } = request.params as { schemaName: string };
      const zodSchema = schemaRegistry[schemaName];

      if (!zodSchema) {
        reply.code(404);
        return { error: "Schema not found", schemaName };
      }

      return z.toJSONSchema(zodSchema);
    },
  });
}
