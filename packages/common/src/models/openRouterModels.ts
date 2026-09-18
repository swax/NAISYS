import { builtInLlmModels } from "./builtInModels.js";
import { LlmApiType } from "./modelTypes.js";

/** Suggest a stable family key without guessing the role of unknown models. */
export function suggestOpenRouterModelKey(id: string): string {
  const slash = id.indexOf("/");
  const provider = id.slice(0, slash);
  const versionName = id.slice(slash + 1);
  const apiType = {
    openai: LlmApiType.OpenAI,
    anthropic: LlmApiType.Anthropic,
    google: LlmApiType.Google,
    "x-ai": LlmApiType.OpenAICompatible,
  }[provider];
  const known = builtInLlmModels.find(
    (model) => model.apiType === apiType && model.versionName === versionName,
  );
  if (known) return `openrouter_${known.key}`;

  // Only recognizable family names get versionless suggestions. Unknown and
  // special routes (e.g. :free) retain their identity and remain editable.
  const claude =
    provider === "anthropic" &&
    /^claude-(?:(?:\d[\d.-]*)-)?(opus|sonnet|haiku)(?:-\d[\d.-]*)?$/.exec(
      versionName,
    );
  if (claude) return `openrouter_claude_${claude[1]}`;
  const gpt =
    provider === "openai" &&
    /^gpt-\d[\d.]*-(astra|sol|terra|luna|mini|nano)$/.exec(versionName);
  if (gpt) return `openrouter_gpt_${gpt[1]}`;
  const gemini =
    provider === "google" &&
    /^gemini-\d[\d.]*-(pro|flash)(?:-preview)?$/.exec(versionName);
  if (gemini) return `openrouter_gemini_${gemini[1]}`;
  return `openrouter_${id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")}`;
}
