import "dotenv/config";
// Important to load dotenv before any other imports, to ensure environment variables are available
import { commonErrorHandler, type StartServer } from "@naisys/common";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import scalarReference from "@scalar/fastify-api-reference";
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
import {
  initHubSessions,
  ensureAdminUser,
  handleResetPassword,
  deployPrismaMigrations,
} from "@naisys/database";
import { SUPERVISOR_DB_VERSION, supervisorDbPath } from "./dbConfig.js";
import prisma from "./db.js";
import { initLogger } from "./logger.js";
import apiRoutes from "./routes/api.js";
import {
  createUser,
  getUserByUuid,
  grantInitialAdminPermissions,
  getUserByUsername,
} from "./services/userService.js";
import { initHubConnection } from "./services/hubConnectionService.js";
import "./schema-registry.js";

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
  const __filename_startup = fileURLToPath(import.meta.url);
  const supervisorServerDir = path.join(path.dirname(__filename_startup), "..");
  await deployPrismaMigrations({
    packageDir: supervisorServerDir,
    databasePath: supervisorDbPath(),
    expectedVersion: SUPERVISOR_DB_VERSION,
  });

  if (!initHubSessions()) {
    console.error(
      "[Supervisor] Hub database not found. Cannot start without it.",
    );
    process.exit(1);
  }

  // Connect to hub via Socket.IO for agent management
  const hubUrl = hubPort ? `http://localhost:${hubPort}` : process.env.HUB_URL;
  if (hubUrl) {
    initHubConnection(hubUrl);
  }

  await ensureAdminUser(async (passwordHash, uuid) => {
    const existing = await getUserByUuid(uuid);
    if (existing) return false;
    const user = await createUser("admin", uuid);
    await grantInitialAdminPermissions(user.id);
    return true;
  });

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

  // Set Zod validator and serializer compilers
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  fastify.setErrorHandler(commonErrorHandler);

  await fastify.register(cors, {
    origin: isProd ? false : ["http://localhost:3002"],
  });

  await fastify.register(cookie);

  await fastify.register(multipart);

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await fastify.register(scalarReference as any, {
    routePrefix: "/supervisor/api-reference",
    configuration: {
      spec: { url: "/api/supervisor/openapi.json" },
      theme: "kepler",
    },
  });

  // Serve the OpenAPI spec with tag groups (filtered to supervisor paths only)
  fastify.get("/api/supervisor/openapi.json", async () => {
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
          tags: ["Discovery", "Authentication", "Users", "Status"],
        },
        { name: "Agents", tags: ["Agents", "Runs", "Mail", "Hosts"] },
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

  fastify.get("/", { schema: { hide: true } }, async (_request, reply) => {
    return reply.redirect("/supervisor/");
  });

  fastify.register(apiRoutes, { prefix: "/api/supervisor" });

  // Public endpoint to expose client configuration (plugins, publicRead, etc.)
  fastify.get(
    "/api/supervisor/client-config",
    { schema: { hide: true } },
    async () => ({ plugins, publicRead: process.env.PUBLIC_READ === "true" }),
  );

  // Conditionally load ERP plugin
  if (plugins.includes("erp")) {
    // Use variable to avoid compile-time type dependency on @naisys-erp/server (allows parallel builds)
    const erpModule = "@naisys-erp/server";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { erpPlugin } = (await import(erpModule)) as { erpPlugin: any };
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
        console.log(
          `[Supervisor] Running on http://${host}:${port}/supervisor, logs written to file`,
        );
        return port;
      } catch (err: any) {
        if (err.code === "EADDRINUSE") {
          console.log(
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
    void handleResetPassword({
      findLocalUser: async (username) => {
        const user = await getUserByUsername(username);
        return user
          ? { id: user.id, username: user.username, uuid: user.uuid }
          : null;
      },
      updateLocalPassword: async () => {},
      requireHub: true,
    });
  } else {
    void startServer("standalone");
  }
}
