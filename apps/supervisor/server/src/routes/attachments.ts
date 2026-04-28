import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { proxyDownloadFromHub } from "../services/attachmentProxyService.js";

export default function attachmentRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /:id or /:id/:filename — Download attachment (proxied through hub)
  const handler = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const publicId = (request.params as { id: string }).id;
    if (!publicId) {
      return reply.code(400).send({ error: "Missing attachment ID" });
    }

    return await proxyDownloadFromHub(publicId, reply);
  };

  const schema = {
    description: "Download an attachment by ID (proxied from hub)",
    tags: ["Attachments"],
  };

  fastify.get<{ Params: { id: string } }>("/:id", { schema }, handler);
  fastify.get<{ Params: { id: string; filename: string } }>(
    "/:id/:filename",
    { schema },
    handler,
  );
}
