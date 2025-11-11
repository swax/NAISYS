import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { HelloResponse, HelloResponseSchema } from "shared";
import accessRoutes from "./access.js";
import settingsRoutes from "./settings.js";
import agentRoutes from "./agent.js";
import mailRoutes from "./mail.js";
import runsRoutes from "./runs.js";

export default async function apiRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{ Reply: HelloResponse }>(
    "/hello",
    {
      schema: {
        description: "Health check endpoint",
        tags: ["General"],
        response: {
          200: HelloResponseSchema,
        },
      },
    },
    async (_request, _reply) => {
      return {
        message: "Hello from Fastify with TypeScript!",
        timestamp: new Date().toISOString(),
        success: true,
      };
    },
  );

  // Register access routes
  await fastify.register(accessRoutes);

  // Register settings routes
  await fastify.register(settingsRoutes);

  // Register agent data routes
  await fastify.register(agentRoutes);

  // Register mail routes
  await fastify.register(mailRoutes);

  // Register runs routes
  await fastify.register(runsRoutes);
}
