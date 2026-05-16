import type { SupervisorPlugin } from "@naisys/common";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { registerAuthMiddleware } from "../auth-middleware.js";
import adminRoutes from "./admin/admin.js";
import authRoutes from "./admin/auth.js";
import userRoutes from "./admin/users.js";
import variablesRoutes from "./admin/variables.js";
import agentChatRoutes from "./agents/agentChat.js";
import agentConfigRoutes from "./agents/agentConfig.js";
import agentLifecycleRoutes from "./agents/agentLifecycle.js";
import agentMailRoutes from "./agents/agentMail.js";
import agentRunsRoutes from "./agents/agentRuns.js";
import agentsRoutes from "./agents/agents.js";
import agentStartupAttachmentsRoutes from "./agents/agentStartupAttachments.js";
import attachmentRoutes from "./infra/attachments.js";
import costsRoutes from "./infra/costs.js";
import hostsRoutes from "./infra/hosts.js";
import modelsRoutes from "./infra/models.js";
import voiceRoutes from "./infra/voice.js";
import rootRoutes from "./root.js";
import schemaRoutes from "./schemas.js";
import statusRoutes from "./status.js";

interface ApiRoutesOptions extends FastifyPluginOptions {
  plugins?: SupervisorPlugin[];
}

export default async function apiRoutes(
  fastify: FastifyInstance,
  options: ApiRoutesOptions,
) {
  // Register auth middleware for all routes in this scope
  registerAuthMiddleware(fastify);

  // Register root discovery routes
  await fastify.register(rootRoutes, { plugins: options.plugins });

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
  await fastify.register(agentStartupAttachmentsRoutes, { prefix: "/agents" });
  await fastify.register(voiceRoutes, { prefix: "/agents" });

  // Register hosts routes
  await fastify.register(hostsRoutes, { prefix: "/hosts" });

  // Register models routes
  await fastify.register(modelsRoutes);

  // Register variables routes
  await fastify.register(variablesRoutes, { prefix: "/variables" });

  // Register costs routes
  await fastify.register(costsRoutes, { prefix: "/costs" });

  // Register admin routes
  await fastify.register(adminRoutes, { prefix: "/admin" });

  // Register attachment routes
  await fastify.register(attachmentRoutes, { prefix: "/attachments" });
}
