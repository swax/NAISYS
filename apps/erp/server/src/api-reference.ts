import type { FastifyInstance } from "fastify";
import { createRequire } from "module";
import { readFileSync } from "node:fs";
import path from "path";

/**
 * Registers Scalar API reference routes for the ERP service.
 *
 * Can't register @scalar/fastify-api-reference twice in the same process
 * (Fastify deduplicates fp() plugins by name), so we serve the Scalar
 * standalone JS bundle and a minimal HTML page manually.
 */
export function registerApiReference(fastify: FastifyInstance) {
  // Serve ERP OpenAPI spec filtered to ERP paths only
  fastify.get("/api/erp/openapi.json", () => {
    const spec = fastify.swagger();
    const filteredPaths: Record<string, unknown> = {};
    for (const [p, value] of Object.entries(spec.paths || {})) {
      if (p.startsWith("/api/erp/")) {
        filteredPaths[p] = value;
      }
    }
    return {
      ...spec,
      info: {
        title: "NAISYS ERP API",
        description: "AI-first ERP system - Order management and definitions",
        version: "1.0.0",
      },
      paths: filteredPaths,
      "x-tagGroups": [
        { name: "General", tags: ["Discovery", "Auth"] },
        {
          name: "Planning",
          tags: ["Planning Orders", "Planning Order Revisions"],
        },
        { name: "Execution", tags: ["Execution Orders"] },
      ],
    };
  });

  // Serve the Scalar standalone JS bundle from the installed package
  const erpRequire = createRequire(import.meta.url);
  const scalarDistDir = path.dirname(
    erpRequire.resolve("@scalar/fastify-api-reference"),
  );
  const scalarJs = readFileSync(
    path.join(scalarDistDir, "js/standalone.js"),
    "utf8",
  );

  fastify.get(
    "/erp/api-reference",
    { schema: { hide: true } },
    async (_request, reply) => {
      return reply.redirect("/erp/api-reference/");
    },
  );

  fastify.get(
    "/erp/api-reference/js/scalar.js",
    { schema: { hide: true } },
    async (_request, reply) => {
      return reply
        .header("Content-Type", "application/javascript; charset=utf-8")
        .send(scalarJs);
    },
  );

  fastify.get(
    "/erp/api-reference/",
    { schema: { hide: true } },
    async (_request, reply) => {
      return reply.header("Content-Type", "text/html; charset=utf-8")
        .send(`<!doctype html>
<html>
  <head>
    <title>NAISYS ERP API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/erp/api-reference/js/scalar.js"><\/script>
    <script type="text/javascript">
      Scalar.createApiReference('#app', {
        url: "/api/erp/openapi.json",
        theme: "kepler"
      })
    <\/script>
  </body>
</html>`);
    },
  );
}
