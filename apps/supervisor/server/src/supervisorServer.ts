import "dotenv/config";
import "./schema-registry.js";

import {
  askQuestion,
  createFileLogger,
  cwdWithTilde,
  ensureDotEnv,
  expandNaisysFolder,
  promptResetSuperAdminAccount,
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
  type BootstrapSupervisor,
  commonErrorHandler,
  MAX_ATTACHMENT_SIZE,
  registerLenientJsonParser,
  registerSecurityHeaders,
  type StartServer,
} from "@naisys/common";
import { createHubDatabaseClient } from "@naisys/hub-database";
import {
  clearUserPassword,
  createSupervisorDatabaseClient,
  deleteAllPasskeyCredentialsForUser,
  deleteAllSessionsForUser,
  deploySupervisorMigrations,
  ensureSuperAdmin,
  hasActiveRegistrationToken,
  issueRegistrationToken,
  userHasPasskey,
} from "@naisys/supervisor-database";
import { PermissionEnum } from "@naisys/supervisor-shared";
import type { FastifyPluginAsync } from "fastify";
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
import {
  cleanupHubConnection,
  initHubConnection,
} from "./services/hubConnectionService.js";
import {
  isPasswordLoginAllowed,
  userHasEnabledPassword,
} from "./services/passwordLoginConfig.js";
import { getVariableCachedValue } from "./services/variableService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Plugin options for registering supervisor inside another Fastify app */
interface SupervisorPluginOptions {
  plugins?: "erp"[];
  serverPort?: number;
  hosted?: boolean;
}

/** DB init + superadmin setup + registration-link prompt. Runs before the plugin so the operator-input wait isn't bounded by pluginTimeout and the prompt doesn't interleave with hub connection logs. */
export const bootstrapSupervisor: BootstrapSupervisor = async (opts) => {
  await deploySupervisorMigrations();

  if (!(await createSupervisorDatabaseClient())) {
    throw new Error(
      "[Supervisor] Supervisor database not found. Cannot start without it.",
    );
  }

  // Hub DB still needed for agent API key auth
  await createHubDatabaseClient();

  // Initialize local Prisma clients (after migrations so they don't lock the DB)
  await initSupervisorDb();
  await initHubDb();

  // Populate in-memory user lookup for username ↔ id resolution
  await refreshUserLookup();

  const superAdminResult = await ensureSuperAdmin();

  if (opts.resetSuperAdminAccount) {
    await deleteAllPasskeyCredentialsForUser(superAdminResult.user.id);
    await clearUserPassword(superAdminResult.user.id);
    // Drop any lingering sessions so an old browser cookie can't outlive the
    // credential it was minted from.
    await deleteAllSessionsForUser(superAdminResult.user.id);
  }

  // Issue a fresh registration token if the superadmin has no way in:
  //  - Just created (first-run bootstrap), or
  //  - Operator asked to reset (--setup), or
  //  - Has no enabled credential AND no unexpired token (recovery / failed prior setup).
  const hasCredential =
    (await userHasPasskey(superAdminResult.user.id)) ||
    (await userHasEnabledPassword(superAdminResult.user.id));
  const needsToken =
    opts.resetSuperAdminAccount ||
    superAdminResult.created ||
    (!hasCredential &&
      !(await hasActiveRegistrationToken(superAdminResult.user.id)));

  if (!needsToken) return;

  const { token } = await issueRegistrationToken(superAdminResult.user.id);
  // Prefer the configured WebAuthn origin so the printed URL is one the
  // browser will actually accept; fall back to a localhost guess otherwise.
  const overrideOrigin = process.env.SUPERVISOR_WEBAUTHN_ORIGIN?.trim()
    ?.split(",")[0]
    ?.trim();
  const portHint = process.env.SERVER_PORT || "3301";
  const baseUrl = overrideOrigin || `http://localhost:${portHint}`;
  const url = `${baseUrl}/supervisor/register?token=${encodeURIComponent(token)}`;

  console.log(`\n  Copy: ${url}`);
  if (process.stdin.isTTY) {
    await askQuestion(
      `  Open the URL above once startup completes. Press Enter to continue: `,
    );
  }
};

/**
 * Fastify plugin that registers Supervisor routes, services, and static files.
 * Can be used standalone or registered inside another Fastify app (e.g. hub).
 */
export const supervisorPlugin: FastifyPluginAsync<
  SupervisorPluginOptions
> = async (fastify, opts) => {
  if (opts.hosted) {
    process.env.NODE_ENV = "production";
  }

  const isProd = process.env.NODE_ENV === "production";

  // Caller must run bootstrapSupervisor() before registering this plugin.

  // Logger — in hosted mode create a dedicated file logger since the
  // parent Fastify may not have one configured. In standalone mode the
  // parent's Fastify logger (configured by startServer) is used.
  if (opts.hosted && process.env.NAISYS_FOLDER) {
    initLogger(createFileLogger("supervisor.log"));
  } else {
    initLogger(fastify.log);
  }

  // Connect to hub via Socket.IO for agent management
  const hubUrl = opts.serverPort
    ? `http://localhost:${opts.serverPort}/hub`
    : process.env.HUB_URL;
  if (hubUrl) {
    initHubConnection(hubUrl);
  }
  fastify.addHook("onClose", (_instance, done) => {
    cleanupHubConnection();
    done();
  });

  // Set Zod validator and serializer compilers
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  registerLenientJsonParser(fastify);

  fastify.setErrorHandler(commonErrorHandler);

  await fastify.register(cors, {
    origin: isProd ? false : ["http://localhost:2201"],
  });

  registerSecurityHeaders(fastify, { enforceHsts: isProd });

  await fastify.register(cookie);

  // Rate limiting
  await fastify.register(rateLimit as any, {
    max: 500,
    timeWindow: "1 minute",
    allowList: (request: { url: string }) =>
      !request.url.match(/^\/(supervisor|erp)\/api\//),
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

  fastify.register(apiRoutes, { prefix: "/supervisor/api" });

  // Public endpoint to expose client configuration (plugins, publicRead, etc.)
  fastify.get(
    "/supervisor/api/client-config",
    { schema: { hide: true } },
    async () => ({
      plugins: opts.plugins,
      publicRead: process.env.PUBLIC_READ === "true",
      allowPasswordLogin: isPasswordLoginAllowed(),
      permissions: PermissionEnum.options,
      mailServiceEnabled:
        (await getVariableCachedValue("MAIL_ENABLED")) === "true",
    }),
  );

  // Conditionally load ERP plugin
  if (opts.plugins?.includes("erp")) {
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

    // Redirect /supervisor → /supervisor/
    fastify.get("/supervisor", { schema: { hide: true } }, (_request, reply) =>
      reply.redirect("/supervisor/"),
    );

    await fastify.register(async (scope) => {
      await scope.register(staticFiles, {
        root: clientDistPath,
        prefix: "/supervisor/",
        wildcard: false,
      });

      // SPA fallback for /supervisor/* routes
      scope.get(
        "/supervisor/*",
        { schema: { hide: true } },
        (request, reply) => {
          if (request.url.startsWith("/supervisor/api")) {
            return reply.code(404).send({ error: "API endpoint not found" });
          }
          // Static asset with file extension that wasn't matched
          if (/\.\w+$/.test(request.url)) {
            return reply.code(404).send({
              error: `Static file not found: ${request.url} — server restart may be needed after a client rebuild`,
            });
          }
          return reply.sendFile("index.html", clientDistPath);
        },
      );
    });
  }

  // Browser Socket.IO (uses a separate path from the hub's Socket.IO)
  initBrowserSocket(fastify.server, isProd);
};

export const cleanupSupervisor = () => {
  cleanupHubConnection();
};

export const startServer: StartServer = async (
  startupType,
  plugins = [],
  hubPort?,
  wizardRan?,
) => {
  if (startupType === "hosted") {
    process.env.NODE_ENV = "production";
  }

  const isProd = process.env.NODE_ENV === "production";

  const fastify = Fastify({
    pluginTimeout: 60_000,
    // trustProxy: TLS terminates at the reverse proxy, so honor X-Forwarded-*
    // headers — otherwise request.protocol reads the internal http hop and
    // registration URLs / WebAuthn origin come out http:// behind https://.
    trustProxy: true,
    logger:
      // Log to file in hosted mode
      isProd
        ? {
            level: "info",
            transport: {
              target: "pino/file",
              options: {
                destination: path
                  .join(
                    process.env.NAISYS_FOLDER || "",
                    "logs",
                    "supervisor.log",
                  )
                  .replaceAll("\\", "/"),
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

  const resetSuperAdminAccount = wizardRan
    ? await promptResetSuperAdminAccount("Supervisor Setup", {
        defaultReset: !process.argv.includes("--setup"),
      })
    : false;

  await bootstrapSupervisor({ resetSuperAdminAccount });

  await fastify.register(supervisorPlugin, {
    plugins,
    serverPort: hubPort,
    hosted: startupType === "hosted",
  });

  try {
    let port = Number(process.env.SERVER_PORT) || 3301;
    const host = isProd ? "0.0.0.0" : "localhost";
    const maxAttempts = 100;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        await fastify.listen({ port, host });
        fastify.log.info(
          `[Supervisor] Running on http://${host}:${port}/supervisor`,
        );
        return port;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
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
  const supervisorWizardConfig: WizardConfig = {
    title: "NAISYS Supervisor Setup",
    sections: [
      {
        type: "fields",
        comment: "Supervisor configuration",
        fields: [
          {
            key: "NAISYS_FOLDER",
            label: "NAISYS Data Folder",
            defaultValue: cwdWithTilde(),
          },
          { key: "HUB_URL", label: "NAISYS Hub URL" },
          { key: "SERVER_PORT", label: "Server Port" },
        ],
      },
    ],
  };

  const supervisorExampleUrl = new URL("../.env.example", import.meta.url);

  let wizardRan = false;
  if (process.argv.includes("--setup")) {
    wizardRan = await runSetupWizard(
      path.resolve(".env"),
      supervisorExampleUrl,
      supervisorWizardConfig,
    );
    expandNaisysFolder();
  }
  wizardRan =
    (await ensureDotEnv(supervisorExampleUrl, supervisorWizardConfig)) ||
    wizardRan;
  void startServer("standalone", [], undefined, wizardRan);
}
