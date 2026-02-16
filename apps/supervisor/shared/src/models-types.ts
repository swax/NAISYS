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
  keyEnvVar: z.string(),
  inputCost: z.number(),
  outputCost: z.number(),
  cacheWriteCost: z.number().optional(),
  cacheReadCost: z.number().optional(),
});

export type LlmModelDetail = z.infer<typeof LlmModelDetailSchema>;

export const ImageModelDetailSchema = z.object({
  key: z.string(),
  label: z.string(),
  versionName: z.string(),
  size: z.string(),
  baseUrl: z.string().optional(),
  keyEnvVar: z.string(),
  cost: z.number(),
  quality: z.string().optional(),
});

export type ImageModelDetail = z.infer<typeof ImageModelDetailSchema>;

export const ModelsResponseSchema = z.object({
  llmModels: z.array(ModelOptionSchema),
  imageModels: z.array(ModelOptionSchema),
  llmModelDetails: z.array(LlmModelDetailSchema),
  imageModelDetails: z.array(ImageModelDetailSchema),
});

export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;
