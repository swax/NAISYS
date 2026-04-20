import type { HateoasAction } from "@naisys/common";
import {
  dbFieldsToImageModel,
  dbFieldsToLlmModel,
  ImageModelSchema,
  LlmModelSchema,
  type ModelDbRow,
} from "@naisys/common";
import type {
  DeleteModelParams,
  DeleteModelResponse,
  ErrorResponse,
  ModelsResponse,
  SaveImageModelRequest,
  SaveLlmModelRequest,
  SaveModelResponse,
} from "@naisys/supervisor-shared";
import {
  DeleteModelParamsSchema,
  DeleteModelResponseSchema,
  ErrorResponseSchema,
  ModelsResponseSchema,
  SaveImageModelRequestSchema,
  SaveLlmModelRequestSchema,
  SaveModelResponseSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";

import { hasPermission, requirePermission } from "../auth-middleware.js";
import { badRequest } from "../error-helpers.js";
import { API_PREFIX } from "../hateoas.js";
import { permGate } from "../route-helpers.js";
import { sendModelsChanged } from "../services/hubConnectionService.js";
import {
  deleteImageModel,
  deleteLlmModel,
  getAllModelsFromDb,
  saveImageModel,
  saveLlmModel,
} from "../services/modelService.js";

function modelActions(hasManagePermission: boolean): HateoasAction[] {
  const gate = permGate(hasManagePermission, "manage_models");
  return [
    {
      rel: "save-llm",
      href: `${API_PREFIX}/models/llm`,
      method: "PUT",
      title: "Save LLM Model",
      schema: `${API_PREFIX}/schemas/SaveLlmModel`,
      ...gate,
    },
    {
      rel: "save-image",
      href: `${API_PREFIX}/models/image`,
      method: "PUT",
      title: "Save Image Model",
      schema: `${API_PREFIX}/schemas/SaveImageModel`,
      ...gate,
    },
    {
      rel: "delete",
      href: `${API_PREFIX}/models/:type/:key`,
      method: "DELETE",
      title: "Delete Model",
      ...gate,
    },
  ];
}

export default function modelsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  // GET /models — list all models with isCustom flag
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
    async (request, _reply) => {
      const allModels = await getAllModelsFromDb();
      const llmRows = allModels.filter((r) => r.type === "llm") as ModelDbRow[];
      const imageRows = allModels.filter(
        (r) => r.type === "image",
      ) as ModelDbRow[];

      const hasManagePermission = hasPermission(
        request.supervisorUser,
        "manage_models",
      );
      const actions = modelActions(hasManagePermission);

      return {
        llmModels: llmRows.map((r) => ({ value: r.key, label: r.label })),
        imageModels: imageRows.map((r) => ({
          value: r.key,
          label: r.label,
        })),
        llmModelDetails: llmRows.map((r) => ({
          ...dbFieldsToLlmModel(r),
          isCustom: r.is_custom,
        })),
        imageModelDetails: imageRows.map((r) => ({
          ...dbFieldsToImageModel(r),
          isCustom: r.is_custom,
        })),
        _actions: actions,
      };
    },
  );

  // PUT /models/llm — upsert custom LLM model
  fastify.put<{
    Body: SaveLlmModelRequest;
    Reply: SaveModelResponse | ErrorResponse;
  }>(
    "/models/llm",
    {
      preHandler: [requirePermission("manage_models")],
      schema: {
        description: "Create or update a custom LLM model",
        tags: ["Models"],
        body: SaveLlmModelRequestSchema,
        response: {
          200: SaveModelResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        // Validate with the full common schema (includes superRefine)
        const parsed = LlmModelSchema.parse(request.body.model);
        const result = await saveLlmModel(parsed);
        sendModelsChanged();
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save LLM model";
        return badRequest(reply, message);
      }
    },
  );

  // PUT /models/image — upsert custom image model
  fastify.put<{
    Body: SaveImageModelRequest;
    Reply: SaveModelResponse | ErrorResponse;
  }>(
    "/models/image",
    {
      preHandler: [requirePermission("manage_models")],
      schema: {
        description: "Create or update a custom image model",
        tags: ["Models"],
        body: SaveImageModelRequestSchema,
        response: {
          200: SaveModelResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const parsed = ImageModelSchema.parse(request.body.model);
        const result = await saveImageModel(parsed);
        sendModelsChanged();
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save image model";
        return badRequest(reply, message);
      }
    },
  );

  // DELETE /models/:type/:key — delete a custom model
  fastify.delete<{
    Params: DeleteModelParams;
    Reply: DeleteModelResponse | ErrorResponse;
  }>(
    "/models/:type/:key",
    {
      preHandler: [requirePermission("manage_models")],
      schema: {
        description:
          "Delete a custom model (reverts to built-in if one exists)",
        tags: ["Models"],
        params: DeleteModelParamsSchema,
        response: {
          200: DeleteModelResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { type, key } = request.params;
        let result;
        if (type === "llm") {
          result = await deleteLlmModel(key);
        } else if (type === "image") {
          result = await deleteImageModel(key);
        } else {
          return badRequest(reply, "Invalid model type");
        }
        sendModelsChanged();
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to delete model";
        return reply.code(500).send({ success: false, message });
      }
    },
  );
}
