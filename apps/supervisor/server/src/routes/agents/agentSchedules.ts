import { nextFireAt, parseSchedulesFromConfigJson } from "@naisys/common";
import type {
  AgentUsernameParams,
  ErrorResponse,
  ScheduleNameParams,
  ScheduleOverviewResponse,
  ScheduleTriggerResult,
} from "@naisys/supervisor-shared";
import {
  AgentUsernameParamsSchema,
  ErrorResponseSchema,
  ScheduleNameParamsSchema,
  ScheduleOverviewResponseSchema,
  ScheduleTriggerResultSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { requirePermission } from "../../authMiddleware.js";
import { hubDb } from "../../database/hubDb.js";
import { notFound } from "../../errorHelpers.js";
import { resolveAgentId } from "../../services/agents/agentService.js";
import {
  getHubTimezone,
  isHubConnected,
  sendScheduleTrigger,
} from "../../services/comms/hubConnectionService.js";

export default function agentSchedulesRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:username/schedules — Schedule overview with next/last fire per entry
  fastify.get<{
    Params: AgentUsernameParams;
    Reply: ScheduleOverviewResponse | ErrorResponse;
  }>(
    "/:username/schedules",
    {
      schema: {
        description: "Schedule overview for an agent",
        tags: ["Agents"],
        params: AgentUsernameParamsSchema,
        response: {
          200: ScheduleOverviewResponseSchema,
          404: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username } = request.params;
      const id = resolveAgentId(username);
      if (!id) return notFound(reply, "Agent not found");

      const user = await hubDb.users.findUnique({
        where: { id },
        select: { config: true },
      });
      if (!user) return notFound(reply, "Agent not found");

      const schedules = parseSchedulesFromConfigJson(user.config);
      const hubTimezone = getHubTimezone();

      // N+1 is fine: `schedules` is typically <5.
      const entries = await Promise.all(
        schedules.map(async (entry) => {
          const lastFire = await hubDb.mail_messages.findFirst({
            where: {
              source: `schedule:${entry.name}`,
              recipients: { some: { user_id: id } },
            },
            orderBy: { id: "desc" },
            select: { body: true, created_at: true },
          });
          const next =
            entry.enabled === false
              ? null
              : nextFireAt(entry.cron, new Date(), hubTimezone);
          return {
            name: entry.name,
            cron: entry.cron,
            enabled: entry.enabled !== false,
            prompt: entry.prompt,
            nextFireAt: next ? next.toISOString() : null,
            lastFireAt: lastFire ? lastFire.created_at.toISOString() : null,
            lastFireBody: lastFire ? lastFire.body : null,
          };
        }),
      );

      return { hubTimezone, entries };
    },
  );

  // POST /:username/schedules/:scheduleName/trigger — Fire on demand
  fastify.post<{
    Params: ScheduleNameParams;
    Reply: ScheduleTriggerResult | ErrorResponse;
  }>(
    "/:username/schedules/:scheduleName/trigger",
    {
      preHandler: [requirePermission("manage_agents")],
      schema: {
        description: "Trigger a named schedule on demand",
        tags: ["Agents"],
        params: ScheduleNameParamsSchema,
        response: {
          200: ScheduleTriggerResultSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username, scheduleName } = request.params;
      const id = resolveAgentId(username);
      if (!id) return notFound(reply, "Agent not found");

      if (!isHubConnected()) {
        return reply
          .status(503)
          .send({ success: false, message: "Hub is not connected" });
      }

      try {
        const response = await sendScheduleTrigger(id, scheduleName);
        return { success: response.ok, message: response.reason };
      } catch (err) {
        return reply.status(500).send({
          success: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
