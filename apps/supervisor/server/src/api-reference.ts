import scalarReference from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";

import { registerAuthMiddleware } from "./auth-middleware.js";

/**
 * Registers Scalar API reference and the filtered OpenAPI spec endpoint
 * for the Supervisor service.
 */
export async function registerApiReference(fastify: FastifyInstance) {
  // Both the reference page and spec endpoint are inside the auth scope.
  // isPublicRoute treats /supervisor/api-reference as non-public (starts
  // with /supervisor/api), so PUBLIC_READ=true allows GET access while
  // PUBLIC_READ=false requires authentication.
  await fastify.register(async (scope) => {
    registerAuthMiddleware(scope);

    await scope.register(scalarReference as any, {
      routePrefix: "/supervisor/api-reference",
      configuration: {
        spec: { url: "/supervisor/api/openapi.json" },
        theme: "kepler",
      },
    });

    scope.get("/supervisor/api/openapi.json", () => {
      const spec = fastify.swagger();
      const filteredPaths: Record<string, unknown> = {};
      for (const [path, value] of Object.entries(spec.paths || {})) {
        if (path.startsWith("/supervisor/api/")) {
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
  });
}
