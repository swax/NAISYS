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
  // Google Models
  {
    key: "gemini1.5",
    name: "gemini-1.5-pro-latest",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // 2 queries per minute free then the prices below are per 1000 characters
    inputCost: 1.25,
    outputCost: 5,
  },
  {
    key: "gemini2.0flash",
    name: "gemini-2.0-flash",
    apiType: LlmApiType.Google,
    maxTokens: 1_000_000,
    // 60 queries per minute free then the prices below are per 1000 characters
    inputCost: 0.1,
    outputCost: 0.4,
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
  },
  {
    key: "claude3.7sonnet",
    name: "claude-3-7-sonnet-latest",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 3,
    outputCost: 15,
  },
  {
    key: "claude3.5haiku",
    name: "claude-3-5-haiku-latest",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 0.8,
    outputCost: 4,
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
