import type { HateoasLink } from "@naisys/common";
import type {
  DashboardResponse,
  ErrorResponse,
} from "@naisys/supervisor-shared";
import {
  DashboardResponseSchema,
  ErrorResponseSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { API_PREFIX, selfLink } from "../hateoas.js";
import { getDashboard } from "../services/observability/dashboardService.js";

function dashboardLinks(): HateoasLink[] {
  return [
    selfLink("/dashboard"),
    { rel: "agents", href: `${API_PREFIX}/agents` },
    { rel: "costs", href: `${API_PREFIX}/costs` },
    { rel: "hosts", href: `${API_PREFIX}/hosts` },
  ];
}

export default function dashboardRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET / — Aggregated recent-activity overview for the supervisor home page
  fastify.get<{
    Reply: DashboardResponse | ErrorResponse;
  }>(
    "/",
    {
      schema: {
        description:
          "Aggregated recent-activity overview: agent runs, messages, spend, alerts, schedules and host health",
        tags: ["Dashboard"],
        response: {
          200: DashboardResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        const data = await getDashboard();
        return {
          success: true,
          message: "Dashboard data retrieved successfully",
          data,
          _links: dashboardLinks(),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load dashboard";
        return reply.code(500).send({ success: false, message });
      }
    },
  );
}
