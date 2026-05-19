import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  loadCustomModels,
  saveCustomModels,
} from "../src/loaders/customModelsLoader.js";

const originalNaisysFolder = process.env.NAISYS_FOLDER;
const tempFolders: string[] = [];

function restoreNaisysFolder() {
  if (originalNaisysFolder === undefined) {
    delete process.env.NAISYS_FOLDER;
  } else {
    process.env.NAISYS_FOLDER = originalNaisysFolder;
  }
}

function makeTempFolder(): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), "common-node-models-"));
  tempFolders.push(folder);
  return folder;
}

describe("custom model loading", () => {
  afterEach(() => {
    restoreNaisysFolder();
    for (const folder of tempFolders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("returns empty model lists when no folder or file is configured", () => {
    expect(loadCustomModels("")).toEqual({ llmModels: [], imageModels: [] });
    expect(loadCustomModels(makeTempFolder())).toEqual({
      llmModels: [],
      imageModels: [],
    });
  });

  test("loads and validates custom LLM and image models from YAML", () => {
    const folder = makeTempFolder();
    writeFileSync(
      path.join(folder, "custom-models.yaml"),
      [
        "llmModels:",
        "  - key: local-llm",
        "    label: Local LLM",
        "    versionName: local-v1",
        "    apiType: openai-compatible",
        "    maxTokens: 4096",
        "    apiKeyVar: LOCAL_LLM_KEY",
        "imageModels:",
        "  - key: local-image",
        "    label: Local Image",
        "    versionName: image-v1",
        "    size: 1024x1024",
        "    apiKeyVar: LOCAL_IMAGE_KEY",
        "    cost: 0.01",
        "",
      ].join("\n"),
    );

    expect(loadCustomModels(folder)).toEqual({
      llmModels: [
        {
          key: "local-llm",
          label: "Local LLM",
          versionName: "local-v1",
          apiType: "openai-compatible",
          maxTokens: 4096,
          apiKeyVar: "LOCAL_LLM_KEY",
          inputCost: 0,
          outputCost: 0,
        },
      ],
      imageModels: [
        {
          key: "local-image",
          label: "Local Image",
          versionName: "image-v1",
          size: "1024x1024",
          apiKeyVar: "LOCAL_IMAGE_KEY",
          cost: 0.01,
        },
      ],
    });
  });

  test("requires NAISYS_FOLDER before saving custom models", () => {
    delete process.env.NAISYS_FOLDER;

    expect(() =>
      saveCustomModels({ llmModels: [], imageModels: [] }),
    ).toThrow("NAISYS_FOLDER environment variable is not set");
  });

  test("saves valid custom models and omits empty sections", () => {
    const folder = makeTempFolder();
    process.env.NAISYS_FOLDER = folder;

    saveCustomModels({
      llmModels: [
        {
          key: "saved-llm",
          label: "Saved LLM",
          versionName: "saved-v1",
          apiType: "openai-compatible",
          maxTokens: 8192,
          apiKeyVar: "SAVED_KEY",
          inputCost: 0,
          outputCost: 0,
        },
      ],
      imageModels: [],
    });

    const raw = readFileSync(path.join(folder, "custom-models.yaml"), "utf-8");
    expect(raw).toContain("llmModels:");
    expect(raw).not.toContain("imageModels:");
    expect(loadCustomModels(folder).llmModels.map((model) => model.key)).toEqual(
      ["saved-llm"],
    );
  });
});
