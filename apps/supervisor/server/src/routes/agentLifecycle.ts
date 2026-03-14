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
  AgentToggleRequest,
  AgentToggleRequestSchema,
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
import { badRequest, notFound } from "../error-helpers.js";
import { isAgentActive } from "../services/agentHostStatusService.js";
import {
  archiveAgent,
  deleteAgent,
  disableAgent,
  enableAgent,
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

async function findSubordinates(
  parentUserId: number,
  filter?: (userId: number) => boolean,
): Promise<number[]> {
  const allUsers = await hubDb.users.findMany({
    select: { id: true, lead_user_id: true },
  });
  const result: number[] = [];
  function collect(parentId: number) {
    for (const user of allUsers) {
      if (user.lead_user_id === parentId) {
        if (!filter || filter(user.id)) {
          result.push(user.id);
        }
        collect(user.id);
      }
    }
  }
  collect(parentUserId);
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
      const { username } = request.params;
      const { task } = request.body;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
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
      const { username } = request.params;
      const { recursive } = request.body;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      if (!isHubConnected()) {
        return reply.status(503).send({
          success: false,
          message: "Hub is not connected",
        });
      }

      // Fire-and-forget stops for subordinates when recursive
      if (recursive) {
        const subordinates = await findSubordinates(id, isAgentActive);
        void Promise.all(
          subordinates.map((subId) =>
            sendAgentStop(subId, "Stopped from supervisor (recursive)").catch(
              (err) =>
                request.log.error(
                  err,
                  `Failed to stop subordinate agent ${subId}`,
                ),
            ),
          ),
        );
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
    },
  );

  // POST /:username/enable — Enable agent
  fastify.post<{
    Params: AgentUsernameParams;
    Body: AgentToggleRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:username/enable",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Enable an agent",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        body: AgentToggleRequestSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const { recursive } = request.body;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      const subordinateIds = recursive ? await findSubordinates(id) : [];

      await enableAgent(id);
      await Promise.all(subordinateIds.map((subId) => enableAgent(subId)));
      sendUserListChanged();

      const count = subordinateIds.length + 1;
      return {
        success: true,
        message:
          recursive && count > 1
            ? `Enabled ${count} agent(s)`
            : "Agent enabled",
      };
    },
  );

  // POST /:username/disable — Disable agent
  fastify.post<{
    Params: AgentUsernameParams;
    Body: AgentToggleRequest;
    Reply: AgentActionResult | ErrorResponse;
  }>(
    "/:username/disable",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Disable an agent",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        body: AgentToggleRequestSchema,
        response: {
          200: AgentActionResultSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const { recursive } = request.body;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      const subordinateIds = recursive ? await findSubordinates(id) : [];
      const allIds = [id, ...subordinateIds];

      // Disable all in DB first, then try to stop any active ones
      await Promise.all(allIds.map((agentId) => disableAgent(agentId)));
      sendUserListChanged();

      if (isHubConnected()) {
        const activeIds = allIds.filter((agentId) => isAgentActive(agentId));
        if (activeIds.length > 0) {
          void Promise.all(
            activeIds.map((agentId) =>
              sendAgentStop(agentId, "Agent disabled").catch((err) =>
                request.log.error(
                  err,
                  `Failed to stop disabled agent ${agentId}`,
                ),
              ),
            ),
          );
        }
      }

      const count = allIds.length;
      return {
        success: true,
        message:
          recursive && count > 1
            ? `Disabled ${count} agent(s); stop requested for active ones`
            : isAgentActive(id)
              ? "Agent disabled; stop requested"
              : "Agent disabled",
      };
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
      const { username } = request.params;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      if (isAgentActive(id)) {
        return badRequest(
          reply,
          "Cannot archive an active agent. Stop it first.",
        );
      }

      await archiveAgent(id);
      sendUserListChanged();

      return { success: true, message: "Agent archived" };
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
      const { username } = request.params;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      await unarchiveAgent(id);
      sendUserListChanged();

      return { success: true, message: "Agent unarchived" };
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
      const { username } = request.params;
      const { leadAgentUsername } = request.body;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      await updateLeadAgent(id, leadAgentUsername);
      sendUserListChanged();

      return {
        success: true,
        message: leadAgentUsername
          ? "Lead agent updated"
          : "Lead agent cleared",
      };
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
      const { username } = request.params;
      const id = resolveAgentId(username);

      if (!id) {
        return notFound(reply, "Agent not found");
      }

      if (isAgentActive(id)) {
        return badRequest(
          reply,
          "Cannot delete an active agent. Stop it first.",
        );
      }

      const agent = await getAgent(id);
      if (!agent) {
        return notFound(reply, "Agent not found");
      }

      if (!agent.archived) {
        return badRequest(
          reply,
          "Agent must be archived before it can be deleted.",
        );
      }

      await deleteAgent(id);

      sendUserListChanged();

      return { success: true, message: "Agent permanently deleted" };
    },
  );
}
