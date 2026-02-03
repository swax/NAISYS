import { FastifyInstance, FastifyPluginOptions } from "fastify";
import accessRoutes from "./access.js";
import agentConfigRoutes from "./agent-config.js";
import agentRoutes from "./agent.js";
import controlsRoutes from "./controls.js";
import mailRoutes from "./mail.js";
import runsRoutes from "./runs.js";
import settingsRoutes from "./settings.js";

export default async function apiRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // Register access routes
  await fastify.register(accessRoutes);

  // Register settings routes
  await fastify.register(settingsRoutes);

  // Register agent data routes
  await fastify.register(agentRoutes);

  // Register agent config routes
  await fastify.register(agentConfigRoutes);

  // Register mail routes
  await fastify.register(mailRoutes);

  // Register runs routes
  await fastify.register(runsRoutes);

  // Register controls routes
  await fastify.register(controlsRoutes);
}
