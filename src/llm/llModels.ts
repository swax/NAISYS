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
}

const llmModels: LlmModel[] = [
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
  {
    key: "gpt4mini",
    name: "gpt-4o-mini",
    apiType: LlmApiType.OpenAI,
    maxTokens: 128_000,
    // Prices are per 1M tokens
    inputCost: 0.15,
    outputCost: 0.60,
  },
  {
    key: "gpt4o",
    name: "gpt-4o",
    apiType: LlmApiType.OpenAI,
    maxTokens: 128_000,
    // Prices are per 1M tokens
    inputCost: 5,
    outputCost: 15,
  },
  {
    key: "gpt4turbo",
    name: "gpt-4-turbo",
    apiType: LlmApiType.OpenAI,
    maxTokens: 128_000,
    // Prices are per 1M tokens
    inputCost: 10,
    outputCost: 30,
  },
  {
    key: "gpt3tuned",
    name: "<Set in agent config>",
    apiType: LlmApiType.OpenAI,
    maxTokens: 16_000,
    // Prices are per 1M tokens
    inputCost: 3,
    outputCost: 6,
  },
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
  {
    key: "gemini1.5",
    name: "gemini-1.5-pro-latest",
    apiType: LlmApiType.Google,
    maxTokens: 1_048_576,
    // 2 queries per minute free then the prices below are per 1000 characters
    inputCost: 7,
    outputCost: 21,
  },
  {
    key: "gemini1.0",
    name: "gemini-pro",
    apiType: LlmApiType.Google,
    maxTokens: 30_720,
    // 60 queries per minute free then the prices below are per 1000 characters
    inputCost: 0.5,
    outputCost: 1.5,
  },
  {
    key: "claude3opus",
    name: "claude-3-opus-20240229",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 15,
    outputCost: 75,
  },
  {
    key: "claude3sonnet",
    name: "claude-3-sonnet-20240229",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 3,
    outputCost: 15,
  },
  {
    key: "claude3.5sonnet",
    name: "claude-3-5-sonnet-20240620",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 3,
    outputCost: 15,
  },
  {
    key: "claude3haiku",
    name: "claude-3-haiku-20240307",
    apiType: LlmApiType.Anthropic,
    maxTokens: 200_000,
    // Prices are per 1M tokens
    inputCost: 0.25,
    outputCost: 1.25,
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
