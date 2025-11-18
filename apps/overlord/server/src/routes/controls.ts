import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { readFile } from "fs/promises";
import {
  ErrorResponseSchema,
  GetAgentConfigRequest,
  GetAgentConfigRequestSchema,
  GetAgentConfigResponse,
  GetAgentConfigResponseSchema,
} from "shared";
import { usingNaisysDb } from "../database/naisysDatabase.js";

export default async function controlsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{
    Querystring: GetAgentConfigRequest;
    Reply: GetAgentConfigResponse;
  }>(
    "/controls/agent-config",
    {
      schema: {
        description: "Get agent configuration YAML for a specific user",
        tags: ["Controls"],
        querystring: GetAgentConfigRequestSchema,
        response: {
          200: GetAgentConfigResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { username } = request.query;

        // Look up the user in the database
        const user = await usingNaisysDb(async (prisma) => {
          return await prisma.users.findUnique({
            where: { username },
            select: { agent_path: true },
          });
        });

        if (!user) {
          return reply.status(400).send({
            success: false,
            message: `User '${username}' not found`,
          });
        }

        // Read the agent config file
        try {
          const configContent = await readFile(user.agent_path, "utf-8");
          return {
            success: true,
            message: "Agent configuration retrieved successfully",
            config: configContent,
          };
        } catch (fileError) {
          console.error("Error reading agent config file:", fileError);
          return reply.status(500).send({
            success: false,
            message: `Failed to read agent configuration file at ${user.agent_path}`,
          });
        }
      } catch (error) {
        console.error("Error in /controls/agent-config route:", error);
        return reply.status(500).send({
          success: false,
          message: "Internal server error while fetching agent configuration",
        });
      }
    },
  );
}
