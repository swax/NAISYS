export interface RealtimeModelPricingPerMTok {
  inputText: number;
  inputAudio: number;
  inputImage?: number;
  inputCachedText: number;
  inputCachedAudio: number;
  inputCachedImage?: number;
  outputText: number;
  outputAudio: number;
}

export interface RealtimeModel {
  key: string;
  label: string;
  versionName: string;
  modelIds: readonly string[];
  apiKeyVar: string;
  maxTokens: number;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  pricingPerMTok: RealtimeModelPricingPerMTok;
}

export interface RealtimeUsageTokens {
  inputTextTokens?: number;
  inputAudioTokens?: number;
  inputImageTokens?: number;
  inputCachedTextTokens?: number;
  inputCachedAudioTokens?: number;
  inputCachedImageTokens?: number;
  outputTextTokens?: number;
  outputAudioTokens?: number;
}

export const DEFAULT_REALTIME_MODEL_ID = "gpt-realtime-2";

// Realtime models use modality-specific token rates, so they intentionally
// live outside builtInLlmModels. Prices are per 1M tokens in USD.
// Source: https://openai.com/api/pricing/
export const builtInRealtimeModels: RealtimeModel[] = [
  {
    key: "gpt-realtime",
    label: "GPT Realtime",
    versionName: "gpt-realtime",
    modelIds: ["gpt-realtime", "gpt-realtime-2025-08-28"],
    apiKeyVar: "OPENAI_API_KEY",
    maxTokens: 32_000,
    supportsVision: true,
    pricingPerMTok: {
      inputText: 4.0,
      inputAudio: 32.0,
      inputImage: 5.0,
      inputCachedText: 0.4,
      inputCachedAudio: 0.4,
      inputCachedImage: 0.5,
      outputText: 16.0,
      outputAudio: 64.0,
    },
  },
  {
    key: "gpt-realtime-2",
    label: "GPT Realtime 2",
    versionName: "gpt-realtime-2",
    modelIds: ["gpt-realtime-2"],
    apiKeyVar: "OPENAI_API_KEY",
    maxTokens: 128_000,
    supportsReasoning: true,
    supportsVision: true,
    pricingPerMTok: {
      inputText: 4.0,
      inputAudio: 32.0,
      inputImage: 5.0,
      inputCachedText: 0.4,
      inputCachedAudio: 0.4,
      inputCachedImage: 0.5,
      outputText: 24.0,
      outputAudio: 64.0,
    },
  },
];

export function getRealtimeModel(modelId: string): RealtimeModel | undefined {
  const id = modelId.trim();
  return builtInRealtimeModels.find((model) => model.modelIds.includes(id));
}

export function computeRealtimeModelCost(
  modelId: string,
  usage: RealtimeUsageTokens,
): number {
  const model = getRealtimeModel(modelId);
  if (!model) {
    throw new Error(
      `No realtime pricing is configured for model "${modelId}".`,
    );
  }

  const p = model.pricingPerMTok;
  return (
    ((usage.inputTextTokens ?? 0) * p.inputText +
      (usage.inputAudioTokens ?? 0) * p.inputAudio +
      (usage.inputImageTokens ?? 0) * (p.inputImage ?? 0) +
      (usage.inputCachedTextTokens ?? 0) * p.inputCachedText +
      (usage.inputCachedAudioTokens ?? 0) * p.inputCachedAudio +
      (usage.inputCachedImageTokens ?? 0) * (p.inputCachedImage ?? 0) +
      (usage.outputTextTokens ?? 0) * p.outputText +
      (usage.outputAudioTokens ?? 0) * p.outputAudio) /
    1_000_000
  );
}
