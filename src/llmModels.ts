import * as config from "./config.js";

interface LlmModel {
  key: string;
  baseUrl: string | undefined;
  name: string;
  maxTokens: number;
  inputCost: number;
  outputCost: number;
}

const llmModels: LlmModel[] = [
  {
    key: "gpt4turbo",
    baseUrl: undefined,
    name: "gpt-4-0125-preview",
    maxTokens: 128_000,
    inputCost: 0.01,
    outputCost: 0.03,
  },
  {
    key: "gpt3turbo",
    baseUrl: undefined,
    name: "gpt-3.5-turbo-0125",
    maxTokens: 16_000,
    inputCost: 0.0005,
    outputCost: 0.0015,
  },
  {
    key: "local",
    baseUrl: config.localLlmUrl,
    name: "local",
    maxTokens: 8_000,
    inputCost: 0,
    outputCost: 0,
  },
  {
    key: "google",
    baseUrl: undefined,
    name: "gemini-pro",
    maxTokens: 8_000,
    inputCost: 0,
    outputCost: 0,
  },
];

export function getLLModel(key: string) {
  const model = llmModels.find((m) => m.key === key);

  if (!model) {
    throw `Error, model not found: ${key}`;
  }

  return model;
}
