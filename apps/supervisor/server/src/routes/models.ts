import {
  getAllImageModelOptions,
  getAllImageModels,
  getAllLlmModelOptions,
  getAllLlmModels,
} from "@naisys/common";
import { loadCustomModels } from "@naisys/common/dist/customModelsLoader.js";
import {
  ErrorResponse,
  ErrorResponseSchema,
  ModelsResponse,
  ModelsResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";

export default async function modelsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  fastify.get<{ Reply: ModelsResponse | ErrorResponse }>(
    "/models",
    {
      schema: {
        description: "Get available LLM and image model options",
        tags: ["Models"],
        response: {
          200: ModelsResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        const custom = loadCustomModels();
        return {
          llmModels: getAllLlmModelOptions(custom.llmModels),
          imageModels: getAllImageModelOptions(custom.imageModels),
          llmModelDetails: getAllLlmModels(custom.llmModels),
          imageModelDetails: getAllImageModels(custom.imageModels),
        };
      } catch (error) {
        return reply.code(500).send({
          success: false,
          message: "Error loading model options",
        });
      }
    },
  );
}
