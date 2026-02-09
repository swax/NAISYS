import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { HelloResponseSchema } from "@naisys-erp/shared";

export default async function apiRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get("/hello", {
    schema: {
      response: {
        200: HelloResponseSchema,
      },
    },
    handler: async () => {
      return { message: "Hello from NAISYS ERP!" };
    },
  });
}
