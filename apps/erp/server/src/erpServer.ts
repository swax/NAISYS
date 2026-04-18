import "dotenv/config";
import "./schema-registry.js";

import {
  cwdWithTilde,
  ensureDotEnv,
  expandNaisysFolder,
  promptSuperAdminPassword,
  runSetupWizard,
  type WizardConfig,
} from "@naisys/common-node";
expandNaisysFolder();

// Important to load dotenv before any other imports, to ensure environment variables are available
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fastifyRateLimit as rateLimit } from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import {
  commonErrorHandler,
  registerLenientJsonParser,
  registerSecurityHeaders,
  SUPER_ADMIN_USERNAME,
} from "@naisys/common";
import { createFileLogger } from "@naisys/common-node";
import {
  createHubDatabaseClient,
  deployPrismaMigrations,
} from "@naisys/hub-database";
import { createSupervisorDatabaseClient } from "@naisys/supervisor-database";
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
import { erpRoutes } from "./erpRoutes.js";
import { isSupervisorAuth } from "./supervisorAuth.js";
import {
  ensureLocalSuperAdmin,
  ensureSupervisorSuperAdmin,
} from "./userService.js";
export { enableSupervisorAuth } from "./supervisorAuth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Plugin options for registering ERP inside another Fastify app */
interface ErpPluginOptions {
  /** If provided, used when creating or updating the local superadmin. Prompt in the caller (not here) to avoid Fastify's plugin-registration timeout. Ignored in supervisor-auth mode. */
  superAdminPassword?: string;
}

/**
 * Fastify plugin that registers ERP routes and static files.
 * Can be used standalone or registered inside another Fastify app (e.g. supervisor).
 */
export const erpPlugin: FastifyPluginAsync<ErpPluginOptions> = async (
  fastify,
  opts,
) => {
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
    allowList: (request) => !request.url.match(/^\/(supervisor|erp)\/api\//),
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
    await ensureLocalSuperAdmin(opts.superAdminPassword);
  }

  fastify.setErrorHandler(commonErrorHandler);
  registerAuthMiddleware(fastify);

  // ERP-specific file logger (works in both standalone and hosted mode)
  const naisysFolder = process.env.NAISYS_FOLDER;
  if (naisysFolder) {
    const erpFileLogger = createFileLogger("erp.log");

    erpFileLogger.info("ERP plugin initialized");

    fastify.addHook("onResponse", async (request, reply) => {
      if (!request.url.startsWith("/erp/api")) return;
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
      if (!request.url.startsWith("/erp/api")) return;
      erpFileLogger.error(
        {
          err: { message: error.message, stack: error.stack },
        },
        `${request.method} ${request.url} error`,
      );
    });
  }

  // API routes
  await fastify.register(erpRoutes);

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

async function startServer(wizardRan?: boolean) {
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
    origin: isProd ? false : ["http://localhost:2202"],
    credentials: true,
  });

  registerSecurityHeaders(fastify, { enforceHsts: isProd });

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

  const superAdminPassword =
    wizardRan && !isSupervisorAuth()
      ? await promptSuperAdminPassword("ERP Setup")
      : undefined;

  await fastify.register(erpPlugin, { superAdminPassword });

  const port = Number(process.env.SERVER_PORT) || 3302;
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
    if (!isSupervisorAuth()) {
      console.log(
        `[ERP] Sign in as '${SUPER_ADMIN_USERNAME}' with the password set during setup. Run --setup again to change it.`,
      );
    }
  } catch (err) {
    console.error("[ERP] Failed to start:", err);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const erpWizardConfig: WizardConfig = {
    title: "NAISYS ERP Setup",
    sections: [
      {
        type: "fields",
        comment: "ERP configuration",
        fields: [
          { key: "NAISYS_FOLDER", label: "NAISYS Data Folder", defaultValue: cwdWithTilde() },
          { key: "SERVER_PORT", label: "Server Port" },
          { key: "SUPERVISOR_AUTH", label: "Use Supervisor for Auth" },
          { key: "PUBLIC_READ", label: "Public Read Access" },
        ],
      },
    ],
  };

  const erpExampleUrl = new URL("../.env.example", import.meta.url);

  let wizardRan = false;
  if (process.argv.includes("--setup")) {
    wizardRan = await runSetupWizard(
      path.resolve(".env"),
      erpExampleUrl,
      erpWizardConfig,
    );
    expandNaisysFolder();
  }
  wizardRan =
    (await ensureDotEnv(erpExampleUrl, erpWizardConfig)) || wizardRan;
  void startServer(wizardRan);
}
