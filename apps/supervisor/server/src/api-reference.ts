import scalarReference from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";

/**
 * Registers Scalar API reference and the filtered OpenAPI spec endpoint
 * for the Supervisor service.
 */
export async function registerApiReference(fastify: FastifyInstance) {
  await fastify.register(scalarReference as any, {
    routePrefix: "/supervisor/api-reference",
    configuration: {
      spec: { url: "/api/supervisor/openapi.json" },
      theme: "kepler",
    },
  });

  // Serve the OpenAPI spec with tag groups (filtered to supervisor paths only)
  fastify.get("/api/supervisor/openapi.json", () => {
    const spec = fastify.swagger();
    const filteredPaths: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(spec.paths || {})) {
      if (path.startsWith("/api/supervisor/")) {
        filteredPaths[path] = value;
      }
    }
    return {
      ...spec,
      paths: filteredPaths,
      "x-tagGroups": [
        {
          name: "General",
          tags: ["Discovery", "Authentication", "Hosts", "Status", "Users"],
        },
        {
          name: "Agents",
          tags: ["Agents", "Chat", "Mail", "Runs", "Attachments", "Costs"],
        },
        {
          name: "Configuration",
          tags: ["Models", "Variables"],
        },
        {
          name: "Administration",
          tags: ["Admin"],
        },
      ],
    };
  });
}
