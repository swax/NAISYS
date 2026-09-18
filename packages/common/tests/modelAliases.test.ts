import { describe, expect, test } from "vitest";

import {
  builtInImageModels,
  builtInLlmModels,
} from "../src/models/builtInModels.js";
import {
  dbFieldsToLlmModel,
  dbFieldsToImageModel,
  getAllImageModels,
  imageModelToDbFields,
  ImageModelSchema,
  findLlmModel,
  getAllLlmModels,
  LlmModelSchema,
  llmModelToDbFields,
  validateLlmModelAliases,
} from "../src/models/modelTypes.js";
import { suggestOpenRouterModelKey } from "../src/models/openRouterModels.js";
import {
  getRealtimeModel,
  computeRealtimeModelCost,
} from "../src/models/realtimeModels.js";

test.each([
  ["gpt5", "gpt_sol"],
  ["gpt5mini", "gpt_mini"],
  ["gpt5nano", "gpt_nano"],
  ["grok4", "grok"],
  ["grok4fast", "grok_fast"],
  ["gemini3pro", "gemini_pro"],
  ["gemini3flash", "gemini_flash"],
  ["gemini2pro", "gemini_computer_use"],
  ["gpt52oauth", "gpt_sol_oauth"],
  ["gpt5oauth", "gpt_terra_oauth"],
  ["gpt54minioauth", "gpt_luna_oauth"],
])("preserves existing selection %s as %s", (oldKey, key) => {
  expect(findLlmModel(builtInLlmModels, oldKey)?.key).toBe(key);
});

test("new entries have no throwaway compatibility aliases", () => {
  for (const key of ["gpt6", "gpt56terra", "gpt56luna"]) {
    expect(findLlmModel(builtInLlmModels, key)).toBeUndefined();
  }
  for (const key of ["gpt_astra", "gpt_terra", "gpt_luna", "gpt_astra_oauth"]) {
    expect(findLlmModel(builtInLlmModels, key)?.aliases).toBeUndefined();
  }
});

test("image overrides retain old names through YAML normalization and DB round-trips", () => {
  for (const original of builtInImageModels) {
    const model = getAllImageModels([
      {
        ...original,
        key: original.aliases![0],
        aliases: ["my_image"],
        cost: 42,
      },
    ]);
    const canonical = findLlmModel(model, original.key)!;
    expect(findLlmModel(model, original.aliases![0])).toBe(canonical);
    expect(canonical.cost).toBe(42);
    expect(
      dbFieldsToImageModel({
        id: 1,
        ...imageModelToDbFields(canonical, true, true),
      }),
    ).toEqual(canonical);
  }
  const model = builtInImageModels[0];
  expect(
    ImageModelSchema.safeParse({ ...model, aliases: [model.key] }).success,
  ).toBe(false);
  expect(() =>
    getAllImageModels([model, { ...model, key: model.aliases![0] }]),
  ).toThrow("Multiple custom image models");
  expect(() =>
    validateLlmModelAliases([...builtInLlmModels, ...builtInImageModels]),
  ).not.toThrow();
});

test.each([
  ["openai/gpt-6-astra", "openrouter_gpt_astra"],
  ["openai/gpt-5.6-sol", "openrouter_gpt_sol"],
  ["anthropic/claude-opus-5", "openrouter_claude_opus"],
  ["anthropic/claude-3.5-sonnet", "openrouter_claude_sonnet"],
  ["google/gemini-3.8-flash", "openrouter_gemini_flash"],
  ["x-ai/grok-4.3", "openrouter_grok_fast"],
  ["vendor/unfamiliar-3.2:free", "openrouter_vendor_unfamiliar_3_2_free"],
])("suggests an editable OpenRouter key for %s", (id, key) => {
  expect(suggestOpenRouterModelKey(id)).toBe(key);
});

test("realtime stable name selects the current model without changing legacy selections", () => {
  expect(getRealtimeModel("gpt_realtime")?.versionName).toBe("gpt-realtime-2");
  expect(getRealtimeModel("gpt-realtime-2")).toBe(
    getRealtimeModel("gpt_realtime"),
  );
  expect(getRealtimeModel("gpt-realtime")?.versionName).toBe("gpt-realtime");
  expect(
    computeRealtimeModelCost("gpt_realtime", { outputTextTokens: 1_000_000 }),
  ).toBe(24);
  expect(
    computeRealtimeModelCost("gpt-realtime", { outputTextTokens: 1_000_000 }),
  ).toBe(16);
});

describe("LLM aliases", () => {
  test.each(["opus", "sonnet", "haiku"])(
    "resolves both names for Claude %s to one model",
    (tier) => {
      const canonical = findLlmModel(builtInLlmModels, `claude_${tier}`);
      expect(canonical).toBeDefined();
      expect(findLlmModel(builtInLlmModels, `claude4${tier}`)).toBe(canonical);
      expect(builtInLlmModels.some((m) => m.key === `claude4${tier}`)).toBe(
        false,
      );
    },
  );

  test("round-trips aliases through database metadata", () => {
    const model = findLlmModel(builtInLlmModels, "claude_opus")!;
    expect(
      dbFieldsToLlmModel({ id: 1, ...llmModelToDbFields(model, true, false) }),
    ).toEqual(model);
  });

  test.each(["claude4opus", "claude_opus"])(
    "preserves a custom override saved as %s",
    (key) => {
      const original = findLlmModel(builtInLlmModels, "claude_opus")!;
      const models = getAllLlmModels([
        {
          ...original,
          key,
          aliases: ["my_opus"],
          versionName: "pinned-version",
          inputCost: 42,
        },
      ]);
      const model = findLlmModel(models, "claude_opus")!;
      expect(model.versionName).toBe("pinned-version");
      expect(model.inputCost).toBe(42);
      expect(findLlmModel(models, "claude4opus")).toBe(model);
      expect(findLlmModel(models, "my_opus")).toBe(model);
      expect(models.length).toBe(builtInLlmModels.length);
    },
  );

  test("rejects conflicting custom definitions instead of discarding one", () => {
    const model = findLlmModel(builtInLlmModels, "claude_opus")!;
    expect(() =>
      getAllLlmModels([model, { ...model, key: "claude4opus" }]),
    ).toThrow("Multiple custom models");
  });

  test("rejects duplicate aliases, key collisions, and self aliases", () => {
    expect(() =>
      validateLlmModelAliases([
        { key: "a", aliases: ["old"] },
        { key: "b", aliases: ["old"] },
      ]),
    ).toThrow('"old"');
    expect(() =>
      validateLlmModelAliases([{ key: "a", aliases: ["b"] }, { key: "b" }]),
    ).toThrow('"b"');
    const model = findLlmModel(builtInLlmModels, "claude_opus")!;
    expect(
      LlmModelSchema.safeParse({ ...model, aliases: [model.key] }).success,
    ).toBe(false);
    expect(
      LlmModelSchema.safeParse({ ...model, aliases: ["old", "old"] }).success,
    ).toBe(false);
  });

  test("supports custom model aliases and leaves unknown names unresolved", () => {
    expect(
      findLlmModel([{ key: "custom", aliases: ["short"] }], "short")?.key,
    ).toBe("custom");
    expect(findLlmModel(builtInLlmModels, "missing")).toBeUndefined();
    expect(() => validateLlmModelAliases(builtInLlmModels)).not.toThrow();
  });
});
