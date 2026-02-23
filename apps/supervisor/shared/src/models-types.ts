import { HateoasActionSchema } from "@naisys/common";
import { z } from "zod";

const ModelOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const LlmModelDetailSchema = z.object({
  key: z.string(),
  label: z.string(),
  versionName: z.string(),
  apiType: z.string(),
  maxTokens: z.number(),
  baseUrl: z.string().optional(),
  apiKeyVar: z.string(),
  inputCost: z.number(),
  outputCost: z.number(),
  cacheWriteCost: z.number().optional(),
  cacheReadCost: z.number().optional(),
  supportsVision: z.boolean().optional(),
  supportsHearing: z.boolean().optional(),
  isCustom: z.boolean(),
});

export type LlmModelDetail = z.infer<typeof LlmModelDetailSchema>;

export const ImageModelDetailSchema = z.object({
  key: z.string(),
  label: z.string(),
  versionName: z.string(),
  size: z.string(),
  baseUrl: z.string().optional(),
  apiKeyVar: z.string(),
  cost: z.number(),
  quality: z.string().optional(),
  isCustom: z.boolean(),
});

export type ImageModelDetail = z.infer<typeof ImageModelDetailSchema>;

export const ModelsResponseSchema = z.object({
  llmModels: z.array(ModelOptionSchema),
  imageModels: z.array(ModelOptionSchema),
  llmModelDetails: z.array(LlmModelDetailSchema),
  imageModelDetails: z.array(ImageModelDetailSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

// --- Save / Delete schemas ---

export const SaveLlmModelRequestSchema = z.object({
  model: z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    versionName: z.string().min(1),
    apiType: z.string().min(1),
    maxTokens: z.number().int().positive(),
    baseUrl: z.string().optional(),
    apiKeyVar: z.string(),
    inputCost: z.number().default(0),
    outputCost: z.number().default(0),
    cacheWriteCost: z.number().optional(),
    cacheReadCost: z.number().optional(),
    supportsVision: z.boolean().optional(),
    supportsHearing: z.boolean().optional(),
  }),
});

export type SaveLlmModelRequest = z.infer<typeof SaveLlmModelRequestSchema>;

export const SaveImageModelRequestSchema = z.object({
  model: z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    versionName: z.string().min(1),
    size: z.string().min(1),
    baseUrl: z.string().optional(),
    apiKeyVar: z.string(),
    cost: z.number(),
    quality: z.string().optional(),
  }),
});

export type SaveImageModelRequest = z.infer<typeof SaveImageModelRequestSchema>;

export const SaveModelResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type SaveModelResponse = z.infer<typeof SaveModelResponseSchema>;

export const DeleteModelParamsSchema = z.object({
  type: z.enum(["llm", "image"]),
  key: z.string(),
});

export type DeleteModelParams = z.infer<typeof DeleteModelParamsSchema>;

export const DeleteModelResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  revertedToBuiltIn: z.boolean().optional(),
});

export type DeleteModelResponse = z.infer<typeof DeleteModelResponseSchema>;
