import { z } from "zod";

import { builtInLlmModels, builtInImageModels } from "./builtInModels.js";

// --- Enums ---

export enum LlmApiType {
  OpenAI = "openai",
  Google = "google",
  Anthropic = "anthropic",
  Mock = "mock",
  None = "none",
}

// --- Model schemas ---

export const LlmModelSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    versionName: z.string().min(1),
    apiType: z.enum(LlmApiType),
    maxTokens: z.number().int().positive(),
    baseUrl: z.string().optional(),
    apiKeyVar: z.string(),
    inputCost: z.number().default(0),
    outputCost: z.number().default(0),
    cacheWriteCost: z.number().optional(),
    cacheReadCost: z.number().optional(),
    supportsVision: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.baseUrl &&
      ![LlmApiType.OpenAI, LlmApiType.Anthropic, LlmApiType.Google].includes(
        data.apiType,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `baseUrl is only supported for OpenAI, Anthropic, and Google API types (got "${data.apiType}")`,
        path: ["baseUrl"],
      });
    }
  });

export type LlmModel = z.infer<typeof LlmModelSchema>;

export const ImageModelSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  versionName: z.string().min(1),
  size: z.string().min(1),
  baseUrl: z.string().optional(),
  apiKeyVar: z.string(),
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

// --- DB meta schemas (for JSON stored in models.meta column) ---

const LlmMetaSchema = z.object({
  apiType: z.enum(LlmApiType),
  maxTokens: z.number().int().positive(),
  baseUrl: z.string().optional(),
  apiKeyVar: z.string(),
  inputCost: z.number().default(0),
  outputCost: z.number().default(0),
  cacheWriteCost: z.number().optional(),
  cacheReadCost: z.number().optional(),
  supportsVision: z.boolean().optional(),
});

const ImageMetaSchema = z.object({
  size: z.string().min(1),
  baseUrl: z.string().optional(),
  apiKeyVar: z.string(),
  cost: z.number(),
  quality: z.enum(["standard", "hd"]).optional(),
});

// --- DB conversion helpers ---

/** Row shape returned from prisma models table */
export interface ModelDbRow {
  id: number;
  key: string;
  type: string;
  label: string;
  version_name: string;
  is_builtin: boolean;
  is_custom: boolean;
  meta: string;
}

/** Fields for prisma models.createMany / update (without id, created_at, updated_at) */
export interface ModelDbFields {
  key: string;
  type: string;
  label: string;
  version_name: string;
  is_builtin: boolean;
  is_custom: boolean;
  meta: string;
}

export function llmModelToDbFields(
  model: LlmModel,
  isBuiltin: boolean,
  isCustom: boolean,
): ModelDbFields {
  const { key, label, versionName, ...metaFields } = model;
  return {
    key,
    type: "llm",
    label,
    version_name: versionName,
    is_builtin: isBuiltin,
    is_custom: isCustom,
    meta: JSON.stringify(metaFields),
  };
}

export function imageModelToDbFields(
  model: ImageModel,
  isBuiltin: boolean,
  isCustom: boolean,
): ModelDbFields {
  const { key, label, versionName, ...metaFields } = model;
  return {
    key,
    type: "image",
    label,
    version_name: versionName,
    is_builtin: isBuiltin,
    is_custom: isCustom,
    meta: JSON.stringify(metaFields),
  };
}

export function dbFieldsToLlmModel(row: ModelDbRow): LlmModel {
  const meta = LlmMetaSchema.parse(JSON.parse(row.meta));
  return {
    key: row.key,
    label: row.label,
    versionName: row.version_name,
    ...meta,
  };
}

export function dbFieldsToImageModel(row: ModelDbRow): ImageModel {
  const meta = ImageMetaSchema.parse(JSON.parse(row.meta));
  return {
    key: row.key,
    label: row.label,
    versionName: row.version_name,
    ...meta,
  };
}

// --- Merge helpers ---

function mergeModels<T extends { key: string }>(
  builtIn: T[],
  custom?: T[],
): T[] {
  if (!custom || custom.length === 0) {
    return [...builtIn];
  }
  const result = [...builtIn];
  for (const c of custom) {
    const idx = result.findIndex((m) => m.key === c.key);
    if (idx >= 0) {
      result[idx] = c;
    } else {
      result.push(c);
    }
  }
  return result;
}

export function getAllLlmModels(customLlmModels?: LlmModel[]): LlmModel[] {
  return mergeModels(builtInLlmModels, customLlmModels);
}

export function getAllImageModels(
  customImageModels?: ImageModel[],
): ImageModel[] {
  return mergeModels(builtInImageModels, customImageModels);
}
