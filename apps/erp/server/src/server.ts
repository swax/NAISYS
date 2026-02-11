import "dotenv/config";
// Important to load dotenv before any other imports, to ensure environment variables are available
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import scalarReference from "@scalar/fastify-api-reference";
import Fastify from "fastify";
import fp from "fastify-plugin";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import path from "path";
import { fileURLToPath } from "url";
import { registerAuthMiddleware } from "./auth-middleware.js";
import { registerErrorHandler } from "./error-handler.js";
import auditRoutes from "./routes/audit.js";
import authRoutes from "./routes/auth.js";
import executionOrderRoutes from "./routes/execution-orders.js";
import planningOrderRevisionRoutes from "./routes/planning-order-revisions.js";
import planningOrderRoutes from "./routes/planning-orders.js";
import rootRoute from "./routes/root.js";
import schemaRoutes from "./routes/schemas.js";
import "./schema-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Fastify plugin that registers ERP routes and static files.
 * Can be used standalone or registered inside another Fastify app (e.g. supervisor).
 */
export const erpPlugin = fp(async (fastify) => {
  const isProd = process.env.NODE_ENV === "production";

  // Cookie plugin (guard for supervisor embedding)
  if (!fastify.hasDecorator("parseCookie")) {
    await fastify.register(cookie);
  }

  // Rate limiting — moderate global default, strict overrides on sensitive routes
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    allowList: (request) => !request.url.startsWith("/api/"),
  });

  registerErrorHandler(fastify);
  registerAuthMiddleware(fastify);

  // API routes under /api/erp prefix
  fastify.register(auditRoutes, { prefix: "/api/erp/audit" });
  fastify.register(authRoutes, { prefix: "/api/erp/auth" });
  fastify.register(rootRoute, { prefix: "/api/erp" });
  fastify.register(planningOrderRoutes, {
    prefix: "/api/erp/planning/orders",
  });
  fastify.register(planningOrderRevisionRoutes, {
    prefix: "/api/erp/planning/orders/:orderId/revisions",
  });
  fastify.register(executionOrderRoutes, {
    prefix: "/api/erp/execution/orders",
  });
  fastify.register(schemaRoutes, { prefix: "/api/erp/schemas" });

  // In production, serve the client build
  if (isProd) {
    const clientDistPath = path.join(__dirname, "../client-dist");
    // Serve static assets and SPA fallback in an encapsulated context
    // to avoid decorator conflicts with the supervisor's @fastify/static
    fastify.register(async (scope) => {
      await scope.register(staticFiles, {
        root: clientDistPath,
        prefix: "/erp/",
        wildcard: false,
      });

      // SPA fallback for /erp/* routes (but not /erp/api-reference)
      scope.get("/erp/*", (_request, reply) => {
        const url = _request.url;
        if (url.startsWith("/erp/api-reference")) return reply.callNotFound();
        reply.sendFile("index.html", clientDistPath);
      });
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === "production";

  const fastify = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    },
  }).withTypeProvider<ZodTypeProvider>();

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(cors, {
    origin: isProd ? false : ["http://localhost:5173"],
    credentials: true,
  });

  // Swagger + Scalar for standalone mode
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: "NAISYS ERP API",
        description: "AI-first ERP system - Order management and definitions",
        version: "1.0.0",
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await fastify.register(scalarReference, {
    routePrefix: "/erp/api-reference",
    configuration: {
      spec: { url: "/api/erp/openapi.json" },
      theme: "kepler",
    },
  });

  // Serve the OpenAPI spec at /api/erp/openapi.json
  fastify.get("/api/erp/openapi.json", async () => {
    const spec = fastify.swagger();
    return {
      ...spec,
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

  await fastify.register(erpPlugin);

  const port = Number(process.env.ERP_PORT) || 3002;
  const host = isProd ? "0.0.0.0" : "localhost";

  try {
    await fastify.listen({ port, host });
    console.log(`[ERP] Running on http://${host}:${port}/erp`);
    console.log(
      `[ERP] API Reference: http://${host}:${port}/erp/api-reference`,
    );
  } catch (err) {
    console.error("Failed to start ERP server:", err);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startServer();
}
