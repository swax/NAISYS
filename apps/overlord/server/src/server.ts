import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./routes/api.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: {
    level: "info",
  },
});

await fastify.register(cors, {
  origin:
    process.env.NODE_ENV === "production" ? false : ["http://localhost:5173"],
});

await fastify.register(cookie);

await fastify.register(multipart);

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

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    const host =
      process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";

    await fastify.listen({ port, host });
    console.log(`Server running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
