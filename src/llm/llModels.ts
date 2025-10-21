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
    key: "gpt5",
    name: "gpt-5",
    apiType: LlmApiType.OpenAI,
    maxTokens: 400_000,
    // Prices are per 1M tokens
    inputCost: 1.25,
    outputCost: 10.0,
    cacheWriteCost: 0.125,  // Cached input cost
    cacheReadCost: 0.125,   // Cached input cost
  },
  {
    key: "gpt5mini",
    name: "gpt-5-mini",
    apiType: LlmApiType.OpenAI,
    maxTokens: 400_000,
    // Prices are per 1M tokens
    inputCost: 0.25,
    outputCost: 2.0,
    cacheWriteCost: 0.025,  // Cached input cost
    cacheReadCost: 0.025,   // Cached input cost
  },
  {
    key: "gpt5nano",
    name: "gpt-5-nano",
    apiType: LlmApiType.OpenAI,
    maxTokens: 400_000,
    // Prices are per 1M tokens
    inputCost: 0.05,
    outputCost: 0.4,
    cacheWriteCost: 0.005, // Cached input cost
    cacheReadCost: 0.005,  // Cached input cost
  },
  // Google Models - Prices are per 1M tokens
  {
    key: "gemini2.5pro",
    name: "gemini-2.5-pro",
    apiType: LlmApiType.Google,
    maxTokens: 2_000_000,
    // Prices are per 1M tokens
    inputCost: 1.25, // ≤200k tokens, 2.50 for >200k tokens
    outputCost: 10.0, // ≤200k tokens, 15.0 for >200k tokens,
    cacheWriteCost: 0.125,  // Cached input cost
    cacheReadCost: 0.125,   // Cached input cost
  },
  {
    key: "gemini2.5flash",
    name: "gemini-2.5-flash",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // Prices are per 1M tokens
    inputCost: 0.30,
    outputCost: 2.50,
    cacheWriteCost: 0.030,  // Cached input cost
    cacheReadCost: 0.030,   // Cached input cost
  },
  {
    key: "gemini2.5flashlite",
    name: "gemini-2.5-flash-lite",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // Prices are per 1M tokens
    inputCost: 0.10,
    outputCost: 0.40,
    cacheWriteCost: 0.010,  // Cached input cost
    cacheReadCost: 0.010,   // Cached input cost
  },
  // Anthropic Models
  {
    key: "claude4opus",
    name: "claude-opus-4-20250514",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 15,
    outputCost: 75,
    cacheWriteCost: 18.75, // 25% more than input cost
    cacheReadCost: 1.5,    // 10% of input cost
  },
  {
    key: "claude4sonnet",
    name: "claude-sonnet-4-5-20250929",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 3,
    outputCost: 15,
    cacheWriteCost: 3.75, // 25% more than input cost
    cacheReadCost: 0.3,   // 10% of input cost
  },
  {
    key: "claude4haiku",
    name: "claude-haiku-4-5-20251001",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 1,
    outputCost: 5,
    cacheWriteCost: 1.25,  // 25% more than input cost
    cacheReadCost: 0.10,  // 10% of input cost
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
