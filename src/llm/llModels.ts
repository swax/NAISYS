import * as config from "../config.js";

export enum LlmApiType {
  OpenAI = "openai",
  Google = "google",
  Anthropic = "anthropic",
  OpenRouter = "openrouter",
}

interface LlmModel {
  key: string;
  name: string;
  baseUrl?: string;
  apiType: LlmApiType;
  maxTokens: number;
  inputCost: number;
  outputCost: number;
  cacheWriteCost?: number;
  cacheReadCost?: number;
}

const llmModels: LlmModel[] = [
  {
    key: "local",
    name: config.localLlmName || "local",
    baseUrl: config.localLlmUrl,
    apiType: LlmApiType.OpenAI,
    maxTokens: 8_000,
    // Prices are per 1M tokens
    inputCost: 0,
    outputCost: 0,
  },
  // Open Router
  {
    key: "llama3-405b",
    name: "meta-llama/llama-3.1-405b-instruct",
    baseUrl: "https://openrouter.ai/api/v1",
    apiType: LlmApiType.OpenRouter,
    maxTokens: 128_000,
    // Prices are per 1M tokens
    inputCost: 2.7,
    outputCost: 2.7,
  },
  // OpenAI Models
  // https://openai.com/api/pricing/
  {
    key: "gpt4.1",
    name: "gpt-4.1",
    apiType: LlmApiType.OpenAI,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 2.0,
    outputCost: 8.0,
    cacheWriteCost: 0.5,  // Cached input cost
    cacheReadCost: 0.5,   // Cached input cost
  },
  {
    key: "gpt4.1mini",
    name: "gpt-4.1-mini",
    apiType: LlmApiType.OpenAI,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 0.4,
    outputCost: 1.6,
    cacheWriteCost: 0.1,  // Cached input cost
    cacheReadCost: 0.1,   // Cached input cost
  },
  {
    key: "gpt4.1nano",
    name: "gpt-4.1-nano",
    apiType: LlmApiType.OpenAI,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 0.1,
    outputCost: 0.4,
    cacheWriteCost: 0.025, // Cached input cost
    cacheReadCost: 0.025,  // Cached input cost
  },
  {
    key: "o3",
    name: "o3",
    apiType: LlmApiType.OpenAI,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 2.0,
    outputCost: 8.0,
    cacheWriteCost: 0.5,  // Cached input cost
    cacheReadCost: 0.5,   // Cached input cost
  },
  {
    key: "o4mini",
    name: "o4-mini",
    apiType: LlmApiType.OpenAI,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 1.1,
    outputCost: 4.4,
    cacheWriteCost: 0.275, // Cached input cost
    cacheReadCost: 0.275,  // Cached input cost
  },
  {
    key: "gpto3mini",
    name: "o3-mini",
    apiType: LlmApiType.OpenAI,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 1.1,
    outputCost: 4.4,
  },
  {
    key: "gpt4mini",
    name: "gpt-4o-mini",
    apiType: LlmApiType.OpenAI,
    maxTokens: 128_000,
    // Prices are per 1M tokens
    inputCost: 0.15,
    outputCost: 0.6,
  },
  {
    key: "gpt4o",
    name: "gpt-4o",
    apiType: LlmApiType.OpenAI,
    maxTokens: 128_000,
    // Prices are per 1M tokens
    inputCost: 2.5,
    outputCost: 10,
  },
  // Google Models - Prices are per 1M tokens
  {
    key: "gemini2.5pro",
    name: "gemini-2.5-pro",
    apiType: LlmApiType.Google,
    maxTokens: 2_000_000,
    // Prices are per 1M tokens
    inputCost: 1.25, // ≤200k tokens, 2.50 for >200k tokens
    outputCost: 10.0, // ≤200k tokens, 15.0 for >200k tokens
  },
  {
    key: "gemini2.5flash",
    name: "gemini-2.5-flash",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // Prices are per 1M tokens
    inputCost: 0.30,
    outputCost: 2.50,
  },
  {
    key: "gemini2.5flashlite",
    name: "gemini-2.5-flash-lite",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // Prices are per 1M tokens
    inputCost: 0.10,
    outputCost: 0.40,
  },
  {
    key: "gemini1.5pro",
    name: "gemini-1.5-pro",
    apiType: LlmApiType.Google,
    maxTokens: 2_000_000,
    // Prices are per 1M tokens
    inputCost: 1.25, // ≤128k tokens, 2.50 for >128k tokens
    outputCost: 5.0,  // ≤128k tokens, 10.0 for >128k tokens
  },
  {
    key: "gemini1.5flash",
    name: "gemini-1.5-flash",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // Prices are per 1M tokens
    inputCost: 0.075, // ≤128k tokens, 0.15 for >128k tokens
    outputCost: 0.30,  // ≤128k tokens, 0.60 for >128k tokens
  },
  {
    key: "gemini1.5flash8b",
    name: "gemini-1.5-flash-8b",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // Prices are per 1M tokens
    inputCost: 0.0375, // ≤128k tokens, 0.075 for >128k tokens
    outputCost: 0.15,   // ≤128k tokens, 0.30 for >128k tokens
  },
  {
    key: "gemini2.0flash",
    name: "gemini-2.0-flash",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // Prices are per 1M tokens
    inputCost: 0.10, // text/image/video, 0.70 for audio
    outputCost: 0.40,
  },
  // Anthropic Models
  {
    key: "claude3opus",
    name: "claude-3-opus-latest",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 15,
    outputCost: 75,
    cacheWriteCost: 18.75, // 25% more than input cost
    cacheReadCost: 1.5,    // 10% of input cost
  },
  {
    key: "claude3.7sonnet",
    name: "claude-3-7-sonnet-latest",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 3,
    outputCost: 15,
    cacheWriteCost: 3.75, // 25% more than input cost
    cacheReadCost: 0.3,   // 10% of input cost
  },
  {
    key: "claude3.5haiku",
    name: "claude-3-5-haiku-latest",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 0.8,
    outputCost: 4,
    cacheWriteCost: 1.0,  // 25% more than input cost
    cacheReadCost: 0.08,  // 10% of input cost
  },
  {
    key: "claude4sonnet",
    name: "claude-sonnet-4-20250514",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 3,
    outputCost: 15,
    cacheWriteCost: 3.75, // 25% more than input cost
    cacheReadCost: 0.3,   // 10% of input cost
  },
];

export function getLLModel(keyName: string) {
  const [key, name] = keyName.split("/");

  const model = structuredClone(llmModels.find((m) => m.key === key));

  if (!model) {
    throw `Error, model not found: ${key}`;
  }

  if (name) {
    model.name = name;
  }

  return model;
}
