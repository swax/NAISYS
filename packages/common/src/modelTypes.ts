import { z } from "zod";

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
    apiType: z.nativeEnum(LlmApiType),
    maxTokens: z.number().int().positive(),
    baseUrl: z.string().optional(),
    keyEnvVar: z.string(),
    inputCost: z.number().default(0),
    outputCost: z.number().default(0),
    cacheWriteCost: z.number().optional(),
    cacheReadCost: z.number().optional(),
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
  keyEnvVar: z.string(),
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

// --- Built-in model data ---

export const builtInLlmModels: LlmModel[] = [
  {
    key: LlmApiType.None,
    label: "None",
    versionName: LlmApiType.None,
    apiType: LlmApiType.None,
    keyEnvVar: "",
    maxTokens: 10_000,
    inputCost: 0,
    outputCost: 0,
  },
  {
    key: LlmApiType.Mock,
    label: "Mock",
    versionName: LlmApiType.Mock,
    apiType: LlmApiType.Mock,
    keyEnvVar: "",
    maxTokens: 10_000,
    inputCost: 0,
    outputCost: 0,
  },
  // Open Router
  {
    key: "llama3-405b",
    label: "Llama 3.1 405B",
    versionName: "meta-llama/llama-3.1-405b-instruct",
    baseUrl: "https://openrouter.ai/api/v1",
    apiType: LlmApiType.OpenAI,
    keyEnvVar: "OPENROUTER_API_KEY",
    maxTokens: 128_000,
    inputCost: 2.7,
    outputCost: 2.7,
  },
  // Grok
  {
    key: "grok4",
    label: "Grok 4",
    versionName: "grok-4",
    baseUrl: "https://api.x.ai/v1",
    apiType: LlmApiType.OpenAI,
    keyEnvVar: "XAI_API_KEY",
    maxTokens: 256_000,
    inputCost: 3,
    outputCost: 15,
    cacheWriteCost: 0.75,
    cacheReadCost: 0.75,
  },
  {
    key: "grok4fast",
    label: "Grok 4 Fast",
    versionName: "grok-4-fast",
    baseUrl: "https://api.x.ai/v1",
    apiType: LlmApiType.OpenAI,
    keyEnvVar: "XAI_API_KEY",
    maxTokens: 2_000_000,
    inputCost: 0.2,
    outputCost: 0.5,
    cacheWriteCost: 0.05,
    cacheReadCost: 0.05,
  },
  // OpenAI Models
  // https://openai.com/api/pricing/
  {
    key: "gpt5",
    label: "GPT 5.1",
    versionName: "gpt-5.1",
    apiType: LlmApiType.OpenAI,
    keyEnvVar: "OPENAI_API_KEY",
    maxTokens: 400_000,
    inputCost: 1.25,
    outputCost: 10.0,
    cacheWriteCost: 0.125,
    cacheReadCost: 0.125,
  },
  {
    key: "gpt5mini",
    label: "GPT 5 Mini",
    versionName: "gpt-5-mini",
    apiType: LlmApiType.OpenAI,
    keyEnvVar: "OPENAI_API_KEY",
    maxTokens: 400_000,
    inputCost: 0.25,
    outputCost: 2.0,
    cacheWriteCost: 0.025,
    cacheReadCost: 0.025,
  },
  {
    key: "gpt5nano",
    label: "GPT 5 Nano",
    versionName: "gpt-5-nano",
    apiType: LlmApiType.OpenAI,
    keyEnvVar: "OPENAI_API_KEY",
    maxTokens: 400_000,
    inputCost: 0.05,
    outputCost: 0.4,
    cacheWriteCost: 0.005,
    cacheReadCost: 0.005,
  },
  // Google Models
  {
    key: "gemini3pro",
    label: "Gemini 3 Pro",
    versionName: "gemini-3-pro-image-preview",
    apiType: LlmApiType.Google,
    keyEnvVar: "GOOGLE_API_KEY",
    maxTokens: 2_000_000,
    inputCost: 2.0,
    outputCost: 12.0,
    cacheWriteCost: 0.2,
    cacheReadCost: 0.2,
  },
  {
    key: "gemini2.5pro",
    label: "Gemini 2.5 Pro",
    versionName: "gemini-2.5-pro",
    apiType: LlmApiType.Google,
    keyEnvVar: "GOOGLE_API_KEY",
    maxTokens: 2_000_000,
    inputCost: 1.25,
    outputCost: 10.0,
    cacheWriteCost: 0.125,
    cacheReadCost: 0.125,
  },
  {
    key: "gemini2.5flash",
    label: "Gemini 2.5 Flash",
    versionName: "gemini-2.5-flash",
    apiType: LlmApiType.Google,
    keyEnvVar: "GOOGLE_API_KEY",
    maxTokens: 1_000_000,
    inputCost: 0.3,
    outputCost: 2.5,
    cacheWriteCost: 0.03,
    cacheReadCost: 0.03,
  },
  {
    key: "gemini2.5flashlite",
    label: "Gemini 2.5 Flash Lite",
    versionName: "gemini-2.5-flash-lite",
    apiType: LlmApiType.Google,
    keyEnvVar: "GOOGLE_API_KEY",
    maxTokens: 1_000_000,
    inputCost: 0.1,
    outputCost: 0.4,
    cacheWriteCost: 0.01,
    cacheReadCost: 0.01,
  },
  // Anthropic Models
  {
    key: "claude4opus",
    label: "Claude 4 Opus",
    versionName: "claude-opus-4-20250514",
    apiType: LlmApiType.Anthropic,
    keyEnvVar: "ANTHROPIC_API_KEY",
    maxTokens: 200_000,
    inputCost: 15,
    outputCost: 75,
    cacheWriteCost: 18.75,
    cacheReadCost: 1.5,
  },
  {
    key: "claude4sonnet",
    label: "Claude 4 Sonnet",
    versionName: "claude-sonnet-4-5-20250929",
    apiType: LlmApiType.Anthropic,
    keyEnvVar: "ANTHROPIC_API_KEY",
    maxTokens: 200_000,
    inputCost: 3,
    outputCost: 15,
    cacheWriteCost: 3.75,
    cacheReadCost: 0.3,
  },
  {
    key: "claude4haiku",
    label: "Claude 4 Haiku",
    versionName: "claude-haiku-4-5-20251001",
    apiType: LlmApiType.Anthropic,
    keyEnvVar: "ANTHROPIC_API_KEY",
    maxTokens: 200_000,
    inputCost: 1,
    outputCost: 5,
    cacheWriteCost: 1.25,
    cacheReadCost: 0.1,
  },
];

export const builtInImageModels: ImageModel[] = [
  {
    key: "dalle3-1024-HD",
    label: "DALL-E 3 1024 HD",
    versionName: "dall-e-3",
    size: "1024x1024",
    keyEnvVar: "OPENAI_API_KEY",
    quality: "hd",
    cost: 0.08,
  },
  {
    key: "dalle3-1024",
    label: "DALL-E 3 1024",
    versionName: "dall-e-3",
    size: "1024x1024",
    keyEnvVar: "OPENAI_API_KEY",
    cost: 0.04,
  },
  {
    key: "dalle2-1024",
    label: "DALL-E 2 1024",
    versionName: "dall-e-2",
    size: "1024x1024",
    keyEnvVar: "OPENAI_API_KEY",
    cost: 0.02,
  },
  {
    key: "dalle2-512",
    label: "DALL-E 2 512",
    versionName: "dall-e-2",
    size: "512x512",
    keyEnvVar: "OPENAI_API_KEY",
    cost: 0.018,
  },
  {
    key: "dalle2-256",
    label: "DALL-E 2 256",
    versionName: "dall-e-2",
    size: "256x256",
    keyEnvVar: "OPENAI_API_KEY",
    cost: 0.016,
  },
];

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

export interface ModelOption {
  value: string;
  label: string;
}

export function getAllLlmModelOptions(
  customLlmModels?: LlmModel[],
): ModelOption[] {
  return getAllLlmModels(customLlmModels).map((m) => ({
    value: m.key,
    label: m.label,
  }));
}

export function getAllImageModelOptions(
  customImageModels?: ImageModel[],
): ModelOption[] {
  return getAllImageModels(customImageModels).map((m) => ({
    value: m.key,
    label: m.label,
  }));
}

export function getValidModelKeys(options: ModelOption[]): Set<string> {
  return new Set(options.map((o) => o.value));
}
