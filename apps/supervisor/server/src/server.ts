import type { StartServer } from "@naisys/common";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import scalarReference from "@scalar/fastify-api-reference";
import dotenv from "dotenv";
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
import { initSupervisorDatabase } from "./database/supervisorDatabase.js";
import apiRoutes from "./routes/api.js";

export const startServer: StartServer = async (startupType, plugins = []) => {
  const isProd = process.env.NODE_ENV === "production";

  if (startupType === "hosted" && !isProd) {
    console.error(
      "--supervisor can only be used when .env NODE_ENV=production",
    );
    process.exit(1);
  }

  initSupervisorDatabase();

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

  // Set Zod validator and serializer compilers
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  await fastify.register(cors, {
    origin: isProd ? false : ["http://localhost:5173"],
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
            name: "supervisor_session",
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
        { name: "General", tags: ["Authentication", "Settings"] },
        { name: "Agents", tags: ["Agent", "Agent Config"] },
        { name: "Operations", tags: ["Mail", "Runs"] },
      ],
    };
  });

  fastify.get("/", { schema: { hide: true } }, async (_request, reply) => {
    return reply.redirect("/supervisor/");
  });

  fastify.register(apiRoutes, { prefix: "/api/supervisor" });

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
        break;
      } catch (err: any) {
        if (err.code === "EADDRINUSE") {
          console.log(`Port ${port} is in use, trying port ${port + 1}...`);
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
  } catch (err) {
    console.error("Failed to start Supervisor:", err);
    fastify.log.error(err);
    process.exit(1);
  }
};

// Start server if this file is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dotenv.config({ quiet: true });

  void startServer("standalone");
}
