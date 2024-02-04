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
    name: "gpt-3.5-turbo-1106",
    maxTokens: 16_000,
    inputCost: 0.001,
    outputCost: 0.002,
  },
  local: {
    baseUrl: "http://localhost:1234/v1",
    name: "local",
    maxTokens: 8_000,
    inputCost: 0,
    outputCost: 0,
  },
};
