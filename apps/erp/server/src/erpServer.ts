import "dotenv/config";
import "./schema-registry.js";

// Important to load dotenv before any other imports, to ensure environment variables are available
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fastifyRateLimit as rateLimit } from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import { commonErrorHandler, registerLenientJsonParser } from "@naisys/common";
import {
  createHubDatabaseClient,
  deployPrismaMigrations,
} from "@naisys/hub-database";
import {
  createSupervisorDatabaseClient,
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
import pino from "pino";
import { fileURLToPath } from "url";

import { registerApiReference } from "./api-reference.js";
import { registerAuthMiddleware } from "./auth-middleware.js";
import { ERP_DB_VERSION, erpDbPath } from "./dbConfig.js";
import { initErpDb } from "./erpDb.js";
import adminRoutes from "./routes/admin.js";
import auditRoutes from "./routes/audit.js";
import authRoutes from "./routes/auth.js";
import dispatchRoutes from "./routes/dispatch.js";
import inventoryRoutes from "./routes/inventory.js";
import itemFieldRoutes from "./routes/item-fields.js";
import itemInstanceRoutes from "./routes/item-instances.js";
import itemRoutes from "./routes/items.js";
import laborTicketRoutes from "./routes/labor-tickets.js";
import operationDependencyRoutes from "./routes/operation-dependencies.js";
import operationRunCommentRoutes from "./routes/operation-run-comments.js";
import operationRunTransitionRoutes from "./routes/operation-run-transitions.js";
import operationRunRoutes from "./routes/operation-runs.js";
import operationRoutes from "./routes/operations.js";
import orderRevisionTransitionRoutes from "./routes/order-revision-transitions.js";
import orderRevisionRoutes from "./routes/order-revisions.js";
import orderRunTransitionRoutes from "./routes/order-run-transitions.js";
import orderRunRoutes from "./routes/order-runs.js";
import orderRoutes from "./routes/orders.js";
import rootRoute from "./routes/root.js";
import schemaRoutes from "./routes/schemas.js";
import stepFieldAttachmentRoutes from "./routes/step-field-attachments.js";
import stepFieldRoutes from "./routes/step-fields.js";
import stepRunFieldRoutes from "./routes/step-run-fields.js";
import stepRunRoutes from "./routes/step-runs.js";
import stepRoutes from "./routes/steps.js";
import userPermissionRoutes from "./routes/user-permissions.js";
import userRoutes from "./routes/users.js";
import workCenterRoutes from "./routes/work-centers.js";
import { isSupervisorAuth } from "./supervisorAuth.js";
import {
  ensureLocalSuperAdmin,
  ensureSupervisorSuperAdmin,
  resetLocalPassword,
} from "./userService.js";
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

  // Multipart file upload support
  if (!fastify.hasContentTypeParser("multipart/form-data")) {
    await fastify.register(multipart, { limits: { fileSize: 10_000_000 } });
  }

  // Rate limiting — moderate global default, strict overrides on sensitive routes
  await fastify.register(rateLimit, {
    max: 500,
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

    await ensureSupervisorSuperAdmin();
  } else {
    await ensureLocalSuperAdmin();
  }

  fastify.setErrorHandler(commonErrorHandler);
  registerAuthMiddleware(fastify);

  // ERP-specific file logger (works in both standalone and hosted mode)
  const naisysFolder = process.env.NAISYS_FOLDER;
  if (naisysFolder) {
    const erpLogDest = path.join(naisysFolder, "logs", "erp.log");
    const erpFileLogger = pino(
      { level: "info" },
      pino.destination({ dest: erpLogDest, mkdir: true }),
    );

    erpFileLogger.info("ERP plugin initialized");

    fastify.addHook("onResponse", async (request, reply) => {
      if (!request.url.startsWith("/api/erp")) return;
      const logFn =
        reply.statusCode >= 400 ? erpFileLogger.error : erpFileLogger.info;
      logFn.call(
        erpFileLogger,
        {
          responseTime: reply.elapsedTime,
          statusCode: reply.statusCode,
        },
        `${request.method} ${request.url}`,
      );
    });

    fastify.addHook("onError", async (request, _reply, error) => {
      if (!request.url.startsWith("/api/erp")) return;
      erpFileLogger.error(
        {
          err: { message: error.message, stack: error.stack },
        },
        `${request.method} ${request.url} error`,
      );
    });
  }

  // API routes under /api/erp prefix
  fastify.register(adminRoutes, { prefix: "/api/erp/admin" });
  fastify.register(auditRoutes, { prefix: "/api/erp/audit" });
  fastify.register(authRoutes, { prefix: "/api/erp/auth" });
  fastify.register(dispatchRoutes, { prefix: "/api/erp/dispatch" });
  fastify.register(inventoryRoutes, { prefix: "/api/erp/inventory" });
  fastify.register(rootRoute, { prefix: "/api/erp" });
  fastify.register(itemRoutes, { prefix: "/api/erp/items" });
  fastify.register(itemFieldRoutes, {
    prefix: "/api/erp/items/:key/fields",
  });
  fastify.register(itemInstanceRoutes, {
    prefix: "/api/erp/items/:key/instances",
  });
  fastify.register(orderRoutes, {
    prefix: "/api/erp/orders",
  });
  fastify.register(orderRevisionRoutes, {
    prefix: "/api/erp/orders/:orderKey/revs",
  });
  fastify.register(orderRevisionTransitionRoutes, {
    prefix: "/api/erp/orders/:orderKey/revs",
  });
  fastify.register(orderRunRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs",
  });
  fastify.register(orderRunTransitionRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs",
  });
  fastify.register(operationRoutes, {
    prefix: "/api/erp/orders/:orderKey/revs/:revNo/ops",
  });
  fastify.register(operationDependencyRoutes, {
    prefix: "/api/erp/orders/:orderKey/revs/:revNo/ops/:seqNo/deps",
  });
  fastify.register(operationRunRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs/:runNo/ops",
  });
  fastify.register(operationRunTransitionRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs/:runNo/ops",
  });
  fastify.register(laborTicketRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs/:runNo/ops/:seqNo/labor",
  });
  fastify.register(operationRunCommentRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs/:runNo/ops/:seqNo/comments",
  });
  fastify.register(stepRunRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs/:runNo/ops/:seqNo/steps",
  });
  fastify.register(stepRunFieldRoutes, {
    prefix: "/api/erp/orders/:orderKey/runs/:runNo/ops/:seqNo/steps",
  });
  fastify.register(stepFieldAttachmentRoutes, {
    prefix:
      "/api/erp/orders/:orderKey/runs/:runNo/ops/:seqNo/steps/:stepSeqNo/fields/:fieldSeqNo/attachments",
  });
  fastify.register(stepFieldAttachmentRoutes, {
    prefix:
      "/api/erp/orders/:orderKey/runs/:runNo/ops/:seqNo/steps/:stepSeqNo/sets/:setIndex/fields/:fieldSeqNo/attachments",
  });
  fastify.register(stepRoutes, {
    prefix: "/api/erp/orders/:orderKey/revs/:revNo/ops/:seqNo/steps",
  });
  fastify.register(stepFieldRoutes, {
    prefix:
      "/api/erp/orders/:orderKey/revs/:revNo/ops/:seqNo/steps/:stepSeqNo/fields",
  });
  fastify.register(schemaRoutes, { prefix: "/api/erp/schemas" });
  fastify.register(userRoutes, { prefix: "/api/erp/users" });
  fastify.register(userPermissionRoutes, { prefix: "/api/erp/users" });
  fastify.register(workCenterRoutes, { prefix: "/api/erp/work-centers" });

  // Public endpoint to expose client configuration (publicRead, etc.)
  fastify.get("/api/erp/client-config", { schema: { hide: true } }, () => ({
    publicRead: process.env.PUBLIC_READ === "true",
    supervisorAuth: isSupervisorAuth(),
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
        // If the URL has a file extension, it's a static asset that wasn't matched
        // by the registered routes — likely because the client was rebuilt while
        // the server was running. Return 404 instead of silently serving index.html.
        if (/\.\w+$/.test(url)) {
          reply.code(404).send({
            error: `Static file not found: ${url} — server restart may be needed after a client rebuild`,
          });
          return;
        }
        reply.sendFile("index.html", clientDistPath);
      });
    });
  }
};

async function startServer() {
  const isProd = process.env.NODE_ENV === "production";

  const fastify = Fastify({
    pluginTimeout: 60_000,
    logger: {
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    },
  }).withTypeProvider<ZodTypeProvider>();

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  registerLenientJsonParser(fastify);

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

  const port = Number(process.env.ERP_PORT) || 3201;
  const host = isProd ? "0.0.0.0" : "localhost";

  try {
    await fastify.listen({ port, host });
    console.log(`[ERP] Running on http://${host}:${port}/erp`);
    console.log(
      `[ERP] API Reference: http://${host}:${port}/erp/api-reference`,
    );
    console.log(
      `[ERP] Auth mode: ${isSupervisorAuth() ? "supervisor" : "standalone"}`,
    );
  } catch (err) {
    console.error("[ERP] Failed to start:", err);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
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
