import { LlmApiType, type LlmModel } from "@naisys/common";
import { loadCustomModels } from "@naisys/common/dist/customModelsLoader.js";
import { GlobalConfig } from "../globalConfig.js";

export { LlmApiType };

export function createLLModels({ globalConfig }: GlobalConfig) {
  const llmModels: LlmModel[] = [
    {
      key: LlmApiType.None,
      label: "None",
      versionName: LlmApiType.None,
      apiType: LlmApiType.None,
      maxTokens: 10_000,
      inputCost: 0,
      outputCost: 0,
    },
    // Dummy model is good for testing agent concurrency without incurring costs
    {
      key: LlmApiType.Mock,
      label: "Mock",
      versionName: LlmApiType.Mock,
      apiType: LlmApiType.Mock,
      maxTokens: 10_000,
      inputCost: 0,
      outputCost: 0,
    },
    {
      key: "local",
      label: "Local",
      versionName: globalConfig().localLlmName || "local",
      baseUrl: globalConfig().localLlmUrl,
      apiType: LlmApiType.OpenAI,
      maxTokens: 8_000,
      // Prices are per 1M tokens
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
      // Prices are per 1M tokens
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
      // Prices are per 1M tokens
      inputCost: 3,
      outputCost: 15,
      cacheWriteCost: 0.75, // Cached input cost,
      cacheReadCost: 0.75, // Cached input cost
    },
    {
      key: "grok4fast",
      label: "Grok 4 Fast",
      versionName: "grok-4-fast",
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
      label: "GPT 5.1",
      versionName: "gpt-5.1",
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
      label: "GPT 5 Mini",
      versionName: "gpt-5-mini",
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
      label: "GPT 5 Nano",
      versionName: "gpt-5-nano",
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
      key: "gemini3pro",
      label: "Gemini 3 Pro",
      versionName: "gemini-3-pro-image-preview",
      apiType: LlmApiType.Google,
      maxTokens: 2_000_000,
      // Prices are per 1M tokens
      inputCost: 2.0, // ≤200k tokens, 2.50 for >200k tokens
      outputCost: 12.0, // ≤200k tokens, 15.0 for >200k tokens,
      cacheWriteCost: 0.2, // Cached input cost
      cacheReadCost: 0.2, // Cached input cost
    },
    {
      key: "gemini2.5pro",
      label: "Gemini 2.5 Pro",
      versionName: "gemini-2.5-pro",
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
      label: "Gemini 2.5 Flash",
      versionName: "gemini-2.5-flash",
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
      label: "Gemini 2.5 Flash Lite",
      versionName: "gemini-2.5-flash-lite",
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
      label: "Claude 4 Opus",
      versionName: "claude-opus-4-20250514",
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
      label: "Claude 4 Sonnet",
      versionName: "claude-sonnet-4-5-20250929",
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
      label: "Claude 4 Haiku",
      versionName: "claude-haiku-4-5-20251001",
      apiType: LlmApiType.Anthropic,
      maxTokens: 200_000,
      // Prices are per 1M tokens
      inputCost: 1,
      outputCost: 5,
      cacheWriteCost: 1.25, // 25% more than input cost
      cacheReadCost: 0.1, // 10% of input cost
    },
  ];

  // Merge custom models from custom-models.yaml
  const customModels = loadCustomModels();
  for (const custom of customModels.llmModels ?? []) {
    const existingIndex = llmModels.findIndex((m) => m.key === custom.key);
    if (existingIndex >= 0) {
      llmModels[existingIndex] = custom;
    } else {
      llmModels.push(custom);
    }
  }

  function get(key: string) {
    const model = llmModels.find((m) => m.key === key);

    if (!model) {
      throw `Error, model not found: ${key}`;
    }

    return model;
  }

  return {
    get,
  };
}

export type LLModels = ReturnType<typeof createLLModels>;
