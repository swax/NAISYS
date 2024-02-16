export const llmModel = {
  gpt4turbo: {
    baseUrl: undefined,
    name: "gpt-4-0125-preview",
    maxTokens: 128_000,
    inputCost: 0.01,
    outputCost: 0.03,
  },
  gpt3turbo: {
    baseUrl: undefined,
    name: "gpt-3.5-turbo-0125",
    maxTokens: 16_000,
    inputCost: 0.0005,
    outputCost: 0.0015,
  },
  local: {
    baseUrl: "http://localhost:1234/v1",
    name: "local",
    maxTokens: 8_000,
    inputCost: 0,
    outputCost: 0,
  },
  google: {
    baseUrl: undefined,
    name: "gemini-pro",
    maxTokens: 8_000,
    inputCost: 0,
    outputCost: 0,
  },
};
