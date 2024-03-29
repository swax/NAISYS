import * as config from "../config.js";

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
  maxTokens: number;
  inputCost: number;
  outputCost: number;
}

const llmModels: LlmModel[] = [
  {
    key: "gpt4turbo",
    name: "gpt-4-0125-preview",
    apiType: LlmApiType.OpenAI,
    maxTokens: 128_000,
    // Prices are per 1M tokens
    inputCost: 10,
    outputCost: 30,
  },
  {
    key: "gpt3turbo",
    name: "gpt-3.5-turbo-0125",
    apiType: LlmApiType.OpenAI,
    maxTokens: 16_000,
    // Prices are per 1M tokens
    inputCost: 0.5,
    outputCost: 1.5,
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
    key: "gemini-pro",
    name: "gemini-pro",
    apiType: LlmApiType.Google,
    maxTokens: 8_000,
    // 60 queries per minute free then the prices below are per 1000 characters
    inputCost: 0.000125,
    outputCost: 0.000375,
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
];

export function getLLModel(key: string) {
  const model = llmModels.find((m) => m.key === key);

  if (!model) {
    throw `Error, model not found: ${key}`;
  }

  return model;
}
