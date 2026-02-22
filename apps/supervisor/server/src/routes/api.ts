import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { registerAuthMiddleware } from "../auth-middleware.js";
import userRoutes from "./users.js";
import agentsRoutes from "./agents.js";
import agentLifecycleRoutes from "./agentLifecycle.js";
import agentConfigRoutes from "./agentConfig.js";
import agentRunsRoutes from "./agentRuns.js";
import agentMailRoutes from "./agentMail.js";
import agentChatRoutes from "./agentChat.js";
import authRoutes from "./auth.js";
import hostsRoutes from "./hosts.js";
import mailRoutes from "./mail.js";
import modelsRoutes from "./models.js";
import rootRoutes from "./root.js";
import schemaRoutes from "./schemas.js";
import statusRoutes from "./status.js";
import adminRoutes from "./admin.js";
import variablesRoutes from "./variables.js";

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

  // Register status routes
  await fastify.register(statusRoutes);

  // Register agents routes
  await fastify.register(agentsRoutes, { prefix: "/agents" });
  await fastify.register(agentLifecycleRoutes, { prefix: "/agents" });
  await fastify.register(agentConfigRoutes, { prefix: "/agents" });
  await fastify.register(agentRunsRoutes, { prefix: "/agents" });
  await fastify.register(agentMailRoutes, { prefix: "/agents" });
  await fastify.register(agentChatRoutes, { prefix: "/agents" });

  // Register hosts routes
  await fastify.register(hostsRoutes, { prefix: "/hosts" });

  // Register models routes
  await fastify.register(modelsRoutes);

  // Register variables routes
  await fastify.register(variablesRoutes, { prefix: "/variables" });

  // Register admin routes
  await fastify.register(adminRoutes, { prefix: "/admin" });

  // Register top-level mail routes (send-mail)
  await fastify.register(mailRoutes);
}
