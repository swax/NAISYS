import "dotenv/config";
import "./schema-registry.js";

// Important to load dotenv before any other imports, to ensure environment variables are available
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import { commonErrorHandler, SUPER_ADMIN_USERNAME } from "@naisys/common";
import {
  createHubDatabaseClient,
  deployPrismaMigrations,
} from "@naisys/hub-database";
import {
  createSupervisorDatabaseClient,
  ensureSuperAdmin,
  handleResetPassword,
} from "@naisys/supervisor-database";
import Fastify, { type FastifyPluginAsync } from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import path from "path";
import { fileURLToPath } from "url";

import { registerApiReference } from "./api-reference.js";
import { registerAuthMiddleware } from "./auth-middleware.js";
import { ERP_DB_VERSION, erpDbPath } from "./dbConfig.js";
import { initErpDb } from "./erpDb.js";
import auditRoutes from "./routes/audit.js";
import authRoutes from "./routes/auth.js";
import orderRunRoutes from "./routes/order-runs.js";
import orderRevisionRoutes from "./routes/order-revisions.js";
import orderRoutes from "./routes/orders.js";
import rootRoute from "./routes/root.js";
import schemaRoutes from "./routes/schemas.js";
import { enableSupervisorAuth, isSupervisorAuth } from "./supervisorAuth.js";
import { ensureLocalSuperAdmin, resetLocalPassword } from "./userService.js";
export { enableSupervisorAuth } from "./supervisorAuth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Fastify plugin that registers ERP routes and static files.
 * Can be used standalone or registered inside another Fastify app (e.g. supervisor).
 */
export const erpPlugin: FastifyPluginAsync = async (fastify) => {
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

  // Auto-migrate ERP database
  const erpServerDir = path.join(__dirname, "..");
  await deployPrismaMigrations({
    packageDir: erpServerDir,
    databasePath: erpDbPath(),
    expectedVersion: ERP_DB_VERSION,
  });

  // Initialize SQLite pragmas now that the database exists
  await initErpDb();

  if (isSupervisorAuth()) {
    if (!(await createHubDatabaseClient())) {
      throw new Error(
        "[ERP] Hub database not available. Required for supervisor auth.",
      );
    }
    if (!(await createSupervisorDatabaseClient())) {
      throw new Error(
        "[ERP] Supervisor database not available. Required for supervisor auth.",
      );
    }
  }

  fastify.setErrorHandler(commonErrorHandler);
  registerAuthMiddleware(fastify);

  // API routes under /api/erp prefix
  fastify.register(auditRoutes, { prefix: "/api/erp/audit" });
  fastify.register(authRoutes, { prefix: "/api/erp/auth" });
  fastify.register(rootRoute, { prefix: "/api/erp" });
  fastify.register(orderRoutes, {
    prefix: "/api/erp/orders",
  });
  fastify.register(orderRevisionRoutes, {
    prefix: "/api/erp/orders/:orderKey/revs",
  });
  fastify.register(orderRunRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs",
  });
  fastify.register(schemaRoutes, { prefix: "/api/erp/schemas" });

  // Public endpoint to expose client configuration (publicRead, etc.)
  fastify.get("/api/erp/client-config", { schema: { hide: true } }, () => ({
    publicRead: process.env.PUBLIC_READ === "true",
  }));

  registerApiReference(fastify);

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
};

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
    origin: isProd ? false : ["http://localhost:3202"],
    credentials: true,
  });

  // Swagger (schema collection); Scalar API reference is served by erpPlugin
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

  fastify.get("/", { schema: { hide: true } }, async (_request, reply) => {
    return reply.redirect("/erp/");
  });

  await fastify.register(erpPlugin);

  if (isSupervisorAuth()) {
    const { default: erpDb } = await import("./erpDb.js");
    const result = await ensureSuperAdmin();

    // Upsert superadmin into ERP DB to stay in sync with supervisor
    await erpDb.user.upsert({
      where: { uuid: result.user.uuid },
      create: {
        uuid: result.user.uuid,
        username: result.user.username,
        passwordHash: result.user.passwordHash,
        apiKey: result.user.apiKey,
      },
      update: {
        username: result.user.username,
        passwordHash: result.user.passwordHash,
        apiKey: result.user.apiKey,
      },
    });

    if (result.created) {
      console.log(
        `[ERP] ${SUPER_ADMIN_USERNAME} user created. Password: ${result.generatedPassword}`,
      );
    }
  } else {
    await ensureLocalSuperAdmin();
  }

  const port = Number(process.env.ERP_PORT) || 3201;
  const host = isProd ? "0.0.0.0" : "localhost";

  try {
    await fastify.listen({ port, host });
    console.log(`[ERP] Running on http://${host}:${port}/erp`);
    console.log(
      `[ERP] API Reference: http://${host}:${port}/erp/api-reference`,
    );
  } catch (err) {
    console.error("[ERP] Failed to start:", err);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--supervisor-auth")) {
    enableSupervisorAuth();
  }

  if (process.argv.includes("--reset-password")) {
    const usernameIdx = process.argv.indexOf("--username");
    const passwordIdx = process.argv.indexOf("--password");
    const username =
      usernameIdx !== -1 ? process.argv[usernameIdx + 1] : undefined;
    const password =
      passwordIdx !== -1 ? process.argv[passwordIdx + 1] : undefined;

    await initErpDb();

    if (isSupervisorAuth()) {
      void handleResetPassword({
        findLocalUser: async (username) => {
          const prisma = (await import("./erpDb.js")).default;
          const user = await prisma.user.findUnique({ where: { username } });
          return user
            ? { id: user.id, username: user.username, uuid: user.uuid }
            : null;
        },
        updateLocalPassword: async (userId, passwordHash) => {
          const prisma = (await import("./erpDb.js")).default;
          await prisma.user.update({
            where: { id: userId },
            data: { passwordHash },
          });
        },
        username,
        password,
      });
    } else {
      void resetLocalPassword();
    }
  } else {
    void startServer();
  }
}
