import * as config from "../config.js";

export enum LlmApiType {
  OpenAI = "openai",
  Google = "google",
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
    // Prices are per 1000 tokens
    inputCost: 0.01,
    outputCost: 0.03,
  },
  {
    key: "gpt3turbo",
    name: "gpt-3.5-turbo-0125",
    apiType: LlmApiType.OpenAI,
    maxTokens: 16_000,
    // Prices are per 1000 tokens
    inputCost: 0.0005,
    outputCost: 0.0015,
  },
  {
    key: "local",
    name: config.localLlmName || "local",
    baseUrl: config.localLlmUrl,
    apiType: LlmApiType.OpenAI,
    maxTokens: 8_000,
    inputCost: 0,
    outputCost: 0,
  },
  {
    key: "google",
    name: "gemini-pro",
    apiType: LlmApiType.Google,
    maxTokens: 8_000,
    // 60 queries per minute free then the prices below are per 1000 characters
    inputCost: 0.000125,
    outputCost: 0.000375,
  },
];

export function getLLModel(key: string) {
  const model = llmModels.find((m) => m.key === key);

  if (!model) {
    throw `Error, model not found: ${key}`;
  }

  return model;
}
