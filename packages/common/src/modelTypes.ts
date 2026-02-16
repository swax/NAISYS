import { z } from "zod";
import { LlmModelOptions, ImageModelOptions } from "./agentConfigFile.js";

// --- Enums ---

export enum LlmApiType {
  OpenAI = "openai",
  Google = "google",
  Anthropic = "anthropic",
  Mock = "mock",
  None = "none",
}

// --- Model schemas ---

export const LlmModelSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  versionName: z.string().min(1),
  apiType: z.nativeEnum(LlmApiType),
  maxTokens: z.number().int().positive(),
  baseUrl: z.string().optional(),
  keyEnvVar: z.string().optional(),
  inputCost: z.number().default(0),
  outputCost: z.number().default(0),
  cacheWriteCost: z.number().optional(),
  cacheReadCost: z.number().optional(),
});

export type LlmModel = z.infer<typeof LlmModelSchema>;

export const ImageModelSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  versionName: z.string().min(1),
  size: z.string().min(1),
  cost: z.number(),
  quality: z.enum(["standard", "hd"]).optional(),
});

export type ImageModel = z.infer<typeof ImageModelSchema>;

// --- Custom models file schema ---

export const CustomModelsFileSchema = z.object({
  llmModels: z.array(LlmModelSchema).optional(),
  imageModels: z.array(ImageModelSchema).optional(),
});

export type CustomModelsFile = z.infer<typeof CustomModelsFileSchema>;

// --- Merge helpers ---

export interface ModelOption {
  value: string;
  label: string;
}

export function getAllLlmModelOptions(
  customLlmModels?: LlmModel[],
): ModelOption[] {
  const base: ModelOption[] = LlmModelOptions.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  if (!customLlmModels || customLlmModels.length === 0) {
    return base;
  }

  const result = [...base];
  for (const custom of customLlmModels) {
    const existingIndex = result.findIndex((o) => o.value === custom.key);
    const option = { value: custom.key, label: custom.label };
    if (existingIndex >= 0) {
      result[existingIndex] = option;
    } else {
      result.push(option);
    }
  }
  return result;
}

export function getAllImageModelOptions(
  customImageModels?: ImageModel[],
): ModelOption[] {
  const base: ModelOption[] = ImageModelOptions.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  if (!customImageModels || customImageModels.length === 0) {
    return base;
  }

  const result = [...base];
  for (const custom of customImageModels) {
    const existingIndex = result.findIndex((o) => o.value === custom.key);
    const option = { value: custom.key, label: custom.label };
    if (existingIndex >= 0) {
      result[existingIndex] = option;
    } else {
      result.push(option);
    }
  }
  return result;
}

export function getValidModelKeys(options: ModelOption[]): Set<string> {
  return new Set(options.map((o) => o.value));
}
