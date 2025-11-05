import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import dotenv from "dotenv";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import path from "path";
import { fileURLToPath } from "url";
import { initOverlordDatabase } from "./database/overlordDatabase.js";
import apiRoutes from "./routes/api.js";

export const startServer = async (logType: "logToConsole" | "logToFile") => {
  initOverlordDatabase();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const fastify = Fastify({
    logger:
      logType === "logToFile"
        ? {
            level: "info",
            transport: {
              target: "pino/file",
              options: {
                destination: path.join(
                  process.env.NAISYS_FOLDER || "",
                  "logs",
                  "overlord",
                  "server.log",
                ),
                mkdir: true,
              },
            },
          }
        : {
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
    origin:
      process.env.NODE_ENV === "production" ? false : ["http://localhost:5173"],
  });

  await fastify.register(cookie);

  await fastify.register(multipart);

  // Register Swagger
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: "NAISYS Overlord API",
        description: "API documentation for NAISYS Overlord server",
        version: "1.0.0",
      },
      servers: [
        {
          url: "http://localhost:3001",
          description: "Development server",
        },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "session_token",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/documentation",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });

  fastify.register(apiRoutes, { prefix: "/api" });

  if (process.env.NODE_ENV === "production") {
    const clientDistPath = path.join(__dirname, "../../client/dist");

    await fastify.register(staticFiles, {
      root: clientDistPath,
      prefix: "/overlord/",
    });

    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        reply.code(404).send({ error: "API endpoint not found" });
      } else if (request.url.startsWith("/overlord")) {
        reply.sendFile("index.html");
      } else {
        reply.sendFile("index.html");
      }
    });
  }

  try {
    const port = Number(process.env.OVERLORD_PORT) || 3001;
    const host =
      process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

    await fastify.listen({ port, host });
    console.log(`Server running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config();

  startServer("logToConsole");
}
