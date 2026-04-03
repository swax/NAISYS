import "dotenv/config";
import "./schema-registry.js";

// Important to load dotenv before any other imports, to ensure environment variables are available
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fastifyRateLimit as rateLimit } from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import {
  commonErrorHandler,
  MAX_ATTACHMENT_SIZE,
  registerLenientJsonParser,
  type StartServer,
  SUPER_ADMIN_USERNAME,
} from "@naisys/common";
import { createHubDatabaseClient } from "@naisys/hub-database";
import {
  createSupervisorDatabaseClient,
  deploySupervisorMigrations,
  ensureSuperAdmin,
  handleResetPassword,
} from "@naisys/supervisor-database";
import { PermissionEnum } from "@naisys/supervisor-shared";
import Fastify from "fastify";
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
import { initHubDb } from "./database/hubDb.js";
import { initSupervisorDb } from "./database/supervisorDb.js";
import { initLogger } from "./logger.js";
import apiRoutes from "./routes/api.js";
import { refreshUserLookup } from "./services/agentService.js";
import { initBrowserSocket } from "./services/browserSocketService.js";
import { initHubConnection } from "./services/hubConnectionService.js";
import { getUserByUsername } from "./services/userService.js";

export const startServer: StartServer = async (
  startupType,
  plugins = [],
  hubPort?,
) => {
  const isProd = process.env.NODE_ENV === "production";

  if (startupType === "hosted" && !isProd) {
    console.error(
      "[Supervisor] --supervisor can only be used when .env NODE_ENV=production",
    );
    process.exit(1);
  }

  // Auto-migrate supervisor database
  await deploySupervisorMigrations();

  if (!(await createSupervisorDatabaseClient())) {
    console.error(
      "[Supervisor] Supervisor database not found. Cannot start without it.",
    );
    process.exit(1);
  }

  // Hub DB still needed for agent API key auth
  await createHubDatabaseClient();

  // Initialize local Prisma clients (after migrations so they don't lock the DB)
  await initSupervisorDb();
  await initHubDb();

  // Populate in-memory user lookup for username ↔ id resolution
  await refreshUserLookup();

  const superAdminResult = await ensureSuperAdmin();
  if (superAdminResult.created) {
    console.log(
      `\n  ${SUPER_ADMIN_USERNAME} user created. Password: ${superAdminResult.generatedPassword}`,
    );
    console.log(`  Change it via the web UI or ns-admin-pw command\n`);
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const fastify = Fastify({
    logger:
      // Log to file in hosted mode
      startupType === "hosted"
        ? {
            level: "info",
            transport: {
              target: "pino/file",
              options: {
                destination: path.join(
                  process.env.NAISYS_FOLDER || "",
                  "logs",
                  "supervisor.log",
                ),
                mkdir: true,
              },
            },
          }
        : // Log to console in standalone mode
          {
            level: "info",
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
              },
            },
          },
  }).withTypeProvider<ZodTypeProvider>();

  initLogger(fastify.log);

  // Connect to hub via Socket.IO for agent management
  const hubUrl = hubPort ? `https://localhost:${hubPort}` : process.env.HUB_URL;
  if (hubUrl) {
    initHubConnection(hubUrl);
  }

  // Set Zod validator and serializer compilers
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  registerLenientJsonParser(fastify);

  fastify.setErrorHandler(commonErrorHandler);

  await fastify.register(cors, {
    origin: isProd ? false : ["http://localhost:3002"],
  });

  await fastify.register(cookie);

  // Rate limiting

  await fastify.register(rateLimit as any, {
    max: 500,
    timeWindow: "1 minute",
    allowList: (request: { url: string }) => !request.url.startsWith("/api/"),
  });

  await fastify.register(multipart, {
    limits: { fileSize: MAX_ATTACHMENT_SIZE },
  });

  // Register Swagger + Scalar
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: "NAISYS Supervisor API",
        description: "API documentation for NAISYS Supervisor server",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "naisys_session",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await registerApiReference(fastify);

  fastify.get("/", { schema: { hide: true } }, async (_request, reply) => {
    return reply.redirect("/supervisor/");
  });

  fastify.register(apiRoutes, { prefix: "/api/supervisor" });

  // Public endpoint to expose client configuration (plugins, publicRead, etc.)
  fastify.get(
    "/api/supervisor/client-config",
    { schema: { hide: true } },
    () => ({
      plugins,
      publicRead: process.env.PUBLIC_READ === "true",
      permissions: PermissionEnum.options,
    }),
  );

  // Conditionally load ERP plugin
  if (plugins.includes("erp")) {
    // Use variable to avoid compile-time type dependency on @naisys/erp (allows parallel builds)
    const erpModule = "@naisys/erp";
    const { erpPlugin, enableSupervisorAuth } = (await import(erpModule)) as {
      erpPlugin: any;
      enableSupervisorAuth: any;
    };
    enableSupervisorAuth();
    await fastify.register(erpPlugin);
  }

  if (isProd) {
    const clientDistPath = path.join(__dirname, "../client-dist");

    await fastify.register(staticFiles, {
      root: clientDistPath,
      prefix: "/supervisor/",
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.code(404).send({ error: "API endpoint not found" });
      } else if (request.url.startsWith("/supervisor")) {
        reply.sendFile("index.html");
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  try {
    let port = Number(process.env.SUPERVISOR_PORT) || 3001;
    const host = isProd ? "0.0.0.0" : "localhost";
    const maxAttempts = 100;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        await fastify.listen({ port, host });
        initBrowserSocket(fastify.server, isProd);
        fastify.log.info(
          `[Supervisor] Running on http://${host}:${port}/supervisor`,
        );
        return port;
      } catch (err: any) {
        if (err.code === "EADDRINUSE") {
          fastify.log.warn(
            `[Supervisor] Port ${port} is in use, trying port ${port + 1}...`,
          );
          port++;
          attempts++;
          if (attempts >= maxAttempts) {
            throw new Error(
              `Unable to find available port after ${maxAttempts} attempts`,
            );
          }
        } else {
          throw err;
        }
      }
    }
    // Unreachable — the loop either returns or throws
    throw new Error("Unreachable");
  } catch (err) {
    console.error("[Supervisor] Failed to start:", err);
    fastify.log.error(err);
    process.exit(1);
  }
};

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--reset-password")) {
    const usernameIdx = process.argv.indexOf("--username");
    const passwordIdx = process.argv.indexOf("--password");
    const username =
      usernameIdx !== -1 ? process.argv[usernameIdx + 1] : undefined;
    const password =
      passwordIdx !== -1 ? process.argv[passwordIdx + 1] : undefined;

    await initSupervisorDb();

    void handleResetPassword({
      findLocalUser: async (username) => {
        const user = await getUserByUsername(username);
        return user
          ? { id: user.id, username: user.username, uuid: user.uuid }
          : null;
      },
      updateLocalPassword: async () => {},
      username,
      password,
    });
  } else {
    void startServer("standalone");
  }
}
