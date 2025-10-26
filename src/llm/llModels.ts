import { createConfig } from "../config.js";

export enum LlmApiType {
  OpenAI = "openai",
  Google = "google",
  Anthropic = "anthropic",
}

interface LlmModel {
  key: string;
  name: string;
  baseUrl?: string;
  apiType: LlmApiType;
  keyEnvVar?: string;
  maxTokens: number;
  inputCost: number;
  outputCost: number;
  cacheWriteCost?: number;
  cacheReadCost?: number;
}

export function createLLModels(
  config: Awaited<ReturnType<typeof createConfig>>,
) {
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
      apiType: LlmApiType.OpenAI,
      keyEnvVar: "OPENROUTER_API_KEY",
      maxTokens: 128_000,
      // Prices are per 1M tokens
      inputCost: 2.7,
      outputCost: 2.7,
    },
    // Grok
    {
      key: "grok4",
      name: "grok-4",
      baseUrl: "https://api.x.ai/v1",
      apiType: LlmApiType.OpenAI,
      keyEnvVar: "XAI_API_KEY",
      maxTokens: 256_000,
      // Prices are per 1M tokens
      inputCost: 3,
      outputCost: 15,
      cacheWriteCost: 0.75, // Cached input cost,
      cacheReadCost: 0.75, // Cached input cost
    },
    {
      key: "grok4fast",
      name: "grok-4-fast",
      baseUrl: "https://api.x.ai/v1",
      apiType: LlmApiType.OpenAI,
      keyEnvVar: "XAI_API_KEY",
      maxTokens: 2_000_000,
      // Prices are per 1M tokens
      inputCost: 0.2,
      outputCost: 0.5,
      cacheWriteCost: 0.05, // Cached input cost,
      cacheReadCost: 0.05, // Cached input cost
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
      cacheWriteCost: 0.125, // Cached input cost
      cacheReadCost: 0.125, // Cached input cost
    },
    {
      key: "gpt5mini",
      name: "gpt-5-mini",
      apiType: LlmApiType.OpenAI,
      maxTokens: 400_000,
      // Prices are per 1M tokens
      inputCost: 0.25,
      outputCost: 2.0,
      cacheWriteCost: 0.025, // Cached input cost
      cacheReadCost: 0.025, // Cached input cost
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
      cacheReadCost: 0.005, // Cached input cost
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
      cacheWriteCost: 0.125, // Cached input cost
      cacheReadCost: 0.125, // Cached input cost
    },
    {
      key: "gemini2.5flash",
      name: "gemini-2.5-flash",
      apiType: LlmApiType.Google,
      maxTokens: 1_000_000,
      // Prices are per 1M tokens
      inputCost: 0.3,
      outputCost: 2.5,
      cacheWriteCost: 0.03, // Cached input cost
      cacheReadCost: 0.03, // Cached input cost
    },
    {
      key: "gemini2.5flashlite",
      name: "gemini-2.5-flash-lite",
      apiType: LlmApiType.Google,
      maxTokens: 1_000_000,
      // Prices are per 1M tokens
      inputCost: 0.1,
      outputCost: 0.4,
      cacheWriteCost: 0.01, // Cached input cost
      cacheReadCost: 0.01, // Cached input cost
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
      cacheReadCost: 1.5, // 10% of input cost
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
      cacheReadCost: 0.3, // 10% of input cost
    },
    {
      key: "claude4haiku",
      name: "claude-haiku-4-5-20251001",
      apiType: LlmApiType.Anthropic,
      maxTokens: 200_000,
      // Prices are per 1M tokens
      inputCost: 1,
      outputCost: 5,
      cacheWriteCost: 1.25, // 25% more than input cost
      cacheReadCost: 0.1, // 10% of input cost
    },
  ];

  function get(keyName: string) {
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

  return {
    get,
  };
}
