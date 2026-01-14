import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { getMonitorDbType } from "../database/naisysDatabase.js";
import { MonitorModeResponse, MonitorModeResponseSchema } from "shared";

export default async function systemRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions
) {
  fastify.get<{ Reply: MonitorModeResponse }>(
    "/system/monitor-mode",
    {
      schema: {
        description: "Get the current monitor mode",
        tags: ["System"],
        response: {
          200: MonitorModeResponseSchema,
        },
      },
    },
    async () => {
      return {
        success: true,
        monitorMode: getMonitorDbType(),
      };
    }
  );
}
