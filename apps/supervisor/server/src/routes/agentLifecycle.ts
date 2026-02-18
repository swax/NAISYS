import {
  AgentIdParams,
  AgentIdParamsSchema,
  ErrorResponse,
  ErrorResponseSchema,
  AgentActionResult,
  AgentActionResultSchema,
  AgentStartRequest,
  AgentStartRequestSchema,
  AgentStartResult,
  AgentStartResultSchema,
  AgentStopResult,
  AgentStopResultSchema,
  SetLeadAgentRequest,
  SetLeadAgentRequestSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { requirePermission } from "../auth-middleware.js";
import {
  isAgentActive,
  isHubConnected,
  sendAgentStart,
  sendAgentStop,
  sendUserListChanged,
} from "../services/hubConnectionService.js";
import {
  archiveAgent,
  deleteAgent,
  getAgent,
  unarchiveAgent,
  updateLeadAgent,
} from "../services/agentService.js";
import { usingNaisysDb } from "../database/naisysDatabase.js";

export default async function agentLifecycleRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // POST /:id/start — Start agent via hub
  fastify.post<{
    Params: AgentIdParams;
    Body: AgentStartRequest;
    Reply: AgentStartResult | ErrorResponse;
  }>(
    "/:id/start",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Start an agent via the hub",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        body: AgentStartRequestSchema,
        response: {
          200: AgentStartResultSchema,
          503: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { task } = request.body;

        if (!isHubConnected()) {
          return reply.status(503).send({
            success: false,
            message: "Hub is not connected",
          });
        }

        const naisysUser = await usingNaisysDb(async (prisma) => {
          const user = await prisma.users.findFirst({
            where: { uuid: request.supervisorUser!.uuid },
            select: { id: true },
          });
          if (user) return user;

          return prisma.users.findFirst({
            where: { username: "admin" },
            select: { id: true },
          });
        });

        if (!naisysUser) {
          return reply.status(500).send({
            success: false,
            message: "No matching user found in NAISYS database",
          });
        }

        const response = await sendAgentStart(id, task, naisysUser.id);

        if (response.success) {
          return {
            success: true,
            message: "Agent started",
            hostname: response.hostname,
          };
        } else {
          return reply.status(500).send({
            success: false,
            message: response.error || "Failed to start agent",
          });
        }
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/start route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while starting agent",
        });
      }
    },
  );

  // POST /:id/stop — Stop agent via hub
  fastify.post<{
    Params: AgentIdParams;
    Reply: AgentStopResult | ErrorResponse;
  }>(
    "/:id/stop",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Stop an agent via the hub",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentStopResultSchema,
          503: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (!isHubConnected()) {
          return reply.status(503).send({
            success: false,
            message: "Hub is not connected",
          });
        }

        const response = await sendAgentStop(id, "Stopped from supervisor");

        if (response.success) {
          return {
            success: true,
            message: "Agent stopped",
          };
        } else {
          return reply.status(500).send({
            success: false,
            message: response.error || "Failed to stop agent",
          });
        }
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/stop route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while stopping agent",
        });
      }
    },
  );

  // POST /:id/archive — Archive agent
  fastify.post<{
    Params: AgentIdParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id/archive",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Archive an agent",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (isAgentActive(id)) {
          return reply.status(400).send({
            success: false,
            message: "Cannot archive an active agent. Stop it first.",
          });
        }

        await archiveAgent(id);
        sendUserListChanged();

        return { success: true, message: "Agent archived" };
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/archive route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while archiving agent",
        });
      }
    },
  );

  // POST /:id/unarchive — Unarchive agent
  fastify.post<{
    Params: AgentIdParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id/unarchive",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Unarchive an agent",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        await unarchiveAgent(id);
        sendUserListChanged();

        return { success: true, message: "Agent unarchived" };
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:id/unarchive route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while unarchiving agent",
        });
      }
    },
  );

  // PUT /:id/lead — Set or clear lead agent
  fastify.put<{
    Params: AgentIdParams;
    Body: SetLeadAgentRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id/lead",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Set or clear the lead agent",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        body: SetLeadAgentRequestSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { leadAgentId } = request.body;

        await updateLeadAgent(id, leadAgentId);
        sendUserListChanged();

        return {
          success: true,
          message: leadAgentId ? "Lead agent updated" : "Lead agent cleared",
        };
      } catch (error) {
        request.log.error(error, "Error in PUT /agents/:id/lead route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while updating lead agent",
        });
      }
    },
  );

  // DELETE /:id — Permanently delete agent
  fastify.delete<{
    Params: AgentIdParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:id",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Permanently delete an archived agent",
        tags: ["Agents"],
        params: AgentIdParamsSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (isAgentActive(id)) {
          return reply.status(400).send({
            success: false,
            message: "Cannot delete an active agent. Stop it first.",
          });
        }

        const agent = await getAgent(id);
        if (!agent) {
          return reply.status(404).send({
            success: false,
            message: `Agent with ID ${id} not found`,
          });
        }

        if (!agent.archived) {
          return reply.status(400).send({
            success: false,
            message: "Agent must be archived before it can be deleted.",
          });
        }

        await deleteAgent(id);

        sendUserListChanged();

        return { success: true, message: "Agent permanently deleted" };
      } catch (error) {
        request.log.error(error, "Error in DELETE /agents/:id route");
        return reply.status(500).send({
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Internal server error while deleting agent",
        });
      }
    },
  );
}
