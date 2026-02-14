import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { registerAuthMiddleware } from "../auth-middleware.js";
import userRoutes from "./users.js";
import agentsRoutes from "./agents.js";
import authRoutes from "./auth.js";
import hostsRoutes from "./hosts.js";
import mailRoutes from "./mail.js";
import rootRoutes from "./root.js";
import schemaRoutes from "./schemas.js";
import settingsRoutes from "./settings.js";

export default async function apiRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // Register auth middleware for all routes in this scope
  registerAuthMiddleware(fastify);

  // Register root discovery routes
  await fastify.register(rootRoutes);

  // Register auth routes
  await fastify.register(authRoutes);

  // Register schema routes
  await fastify.register(schemaRoutes, { prefix: "/schemas" });

  // Register user routes
  await fastify.register(userRoutes, { prefix: "/users" });

  // Register settings routes
  await fastify.register(settingsRoutes);

  // Register agents routes (includes config, runs, mail sub-routes)
  await fastify.register(agentsRoutes, { prefix: "/agents" });

  // Register hosts routes
  await fastify.register(hostsRoutes, { prefix: "/hosts" });

  // Register top-level mail routes (send-mail)
  await fastify.register(mailRoutes);
}
