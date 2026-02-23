import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { proxyDownloadFromHub } from "../services/attachmentProxyService.js";

export default function attachmentRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:id — Download attachment (proxied through hub)
  fastify.get<{
    Params: { id: string };
  }>(
    "/:id",
    {
      schema: {
        description: "Download an attachment by ID (proxied from hub)",
        tags: ["Attachments"],
      },
    },
    async (request, reply) => {
      const attachmentId = parseInt(request.params.id, 10);
      if (isNaN(attachmentId)) {
        return reply.code(400).send({ error: "Invalid attachment ID" });
      }

      await proxyDownloadFromHub(attachmentId, reply);
    },
  );
}
