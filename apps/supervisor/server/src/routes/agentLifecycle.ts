import {
  AgentActionResult,
  AgentActionResultSchema,
  AgentStartRequest,
  AgentStartRequestSchema,
  AgentStartResult,
  AgentStartResultSchema,
  AgentStopRequest,
  AgentStopRequestSchema,
  AgentStopResult,
  AgentStopResultSchema,
  AgentUsernameParams,
  AgentUsernameParamsSchema,
  ErrorResponse,
  ErrorResponseSchema,
  SetLeadAgentRequest,
  SetLeadAgentRequestSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

import { requirePermission } from "../auth-middleware.js";
import { hubDb } from "../database/hubDb.js";
import { isAgentActive } from "../services/agentHostStatusService.js";
import {
  archiveAgent,
  deleteAgent,
  getAgent,
  resolveAgentId,
  unarchiveAgent,
  updateLeadAgent,
} from "../services/agentService.js";
import {
  isHubConnected,
  sendAgentStart,
  sendAgentStop,
  sendUserListChanged,
} from "../services/hubConnectionService.js";

async function findRunningSubordinates(
  parentUserId: number,
): Promise<number[]> {
  const allUsers = await hubDb.users.findMany({
    select: { id: true, lead_user_id: true },
  });
  const result: number[] = [];
  function collectSubordinates(parentId: number) {
    for (const user of allUsers) {
      if (user.lead_user_id === parentId) {
        if (isAgentActive(user.id)) {
          result.push(user.id);
        }
        collectSubordinates(user.id);
      }
    }
  }
  collectSubordinates(parentUserId);
  return result;
}

export default function agentLifecycleRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // POST /:username/start — Start agent via hub
  fastify.post<{
    Params: AgentUsernameParams;
    Body: AgentStartRequest;
    Reply: AgentStartResult | ErrorResponse;
  }>(
    "/:username/start",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Start an agent via the hub",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
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
        const { username } = request.params;
        const { task } = request.body;
        const id = resolveAgentId(username);

        if (!id) {
          return reply.status(404).send({
            success: false,
            message: `Agent '${username}' not found`,
          });
        }

        if (!isHubConnected()) {
          return reply.status(503).send({
            success: false,
            message: "Hub is not connected",
          });
        }

        const naisysUser =
          (await hubDb.users.findFirst({
            where: { uuid: request.supervisorUser!.uuid },
            select: { id: true },
          })) ??
          (await hubDb.users.findFirst({
            where: { username: "admin" },
            select: { id: true },
          }));

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
        request.log.error(error, "Error in POST /agents/:username/start route");
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

  // POST /:username/stop — Stop agent via hub
  fastify.post<{
    Params: AgentUsernameParams;
    Body: AgentStopRequest;
    Reply: AgentStopResult | ErrorResponse;
  }>(
    "/:username/stop",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Stop an agent via the hub",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        body: AgentStopRequestSchema,
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
        const { username } = request.params;
        const { recursive } = request.body;
        const id = resolveAgentId(username);

        if (!id) {
          return reply.status(404).send({
            success: false,
            message: `Agent '${username}' not found`,
          });
        }

        if (!isHubConnected()) {
          return reply.status(503).send({
            success: false,
            message: "Hub is not connected",
          });
        }

        // Fire-and-forget stops for subordinates when recursive
        if (recursive) {
          const subordinates = await findRunningSubordinates(id);
          for (const subId of subordinates) {
            sendAgentStop(subId, "Stopped from supervisor (recursive)").catch(
              (err) =>
                request.log.error(
                  err,
                  `Failed to stop subordinate agent ${subId}`,
                ),
            );
          }
        }

        const response = await sendAgentStop(id, "Stopped from supervisor");

        if (response.success) {
          return {
            success: true,
            message: recursive
              ? "Agent and subordinates stopped"
              : "Agent stopped",
          };
        } else {
          return reply.status(500).send({
            success: false,
            message: response.error || "Failed to stop agent",
          });
        }
      } catch (error) {
        request.log.error(error, "Error in POST /agents/:username/stop route");
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

  // POST /:username/archive — Archive agent
  fastify.post<{
    Params: AgentUsernameParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:username/archive",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Archive an agent",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
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
        const { username } = request.params;
        const id = resolveAgentId(username);

        if (!id) {
          return reply.status(404).send({
            success: false,
            message: `Agent '${username}' not found`,
          });
        }

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
        request.log.error(
          error,
          "Error in POST /agents/:username/archive route",
        );
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

  // POST /:username/unarchive — Unarchive agent
  fastify.post<{
    Params: AgentUsernameParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:username/unarchive",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Unarchive an agent",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
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
        const { username } = request.params;
        const id = resolveAgentId(username);

        if (!id) {
          return reply.status(404).send({
            success: false,
            message: `Agent '${username}' not found`,
          });
        }

        await unarchiveAgent(id);
        sendUserListChanged();

        return { success: true, message: "Agent unarchived" };
      } catch (error) {
        request.log.error(
          error,
          "Error in POST /agents/:username/unarchive route",
        );
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

  // PUT /:username/lead — Set or clear lead agent
  fastify.put<{
    Params: AgentUsernameParams;
    Body: SetLeadAgentRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:username/lead",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Set or clear the lead agent",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
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
        const { username } = request.params;
        const { leadAgentUsername } = request.body;
        const id = resolveAgentId(username);

        if (!id) {
          return reply.status(404).send({
            success: false,
            message: `Agent '${username}' not found`,
          });
        }

        await updateLeadAgent(id, leadAgentUsername);
        sendUserListChanged();

        return {
          success: true,
          message: leadAgentUsername
            ? "Lead agent updated"
            : "Lead agent cleared",
        };
      } catch (error) {
        request.log.error(error, "Error in PUT /agents/:username/lead route");
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

  // DELETE /:username — Permanently delete agent
  fastify.delete<{
    Params: AgentUsernameParams;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:username",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Permanently delete an archived agent",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
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
        const { username } = request.params;
        const id = resolveAgentId(username);

        if (!id) {
          return reply.status(404).send({
            success: false,
            message: `Agent '${username}' not found`,
          });
        }

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
            message: `Agent '${username}' not found`,
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
        request.log.error(error, "Error in DELETE /agents/:username route");
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
