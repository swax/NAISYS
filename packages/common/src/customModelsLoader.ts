import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { CustomModelsFileSchema, type CustomModelsFile } from "./modelTypes.js";

export function loadCustomModels(naisysFolder?: string): CustomModelsFile {
  const folder = naisysFolder || process.env.NAISYS_FOLDER;
  if (!folder) {
    return { llmModels: [], imageModels: [] };
  }

  const filePath = path.join(folder, "custom-models.yaml");

  if (!fs.existsSync(filePath)) {
    return { llmModels: [], imageModels: [] };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = yaml.load(raw);
  const result = CustomModelsFileSchema.parse(parsed);

  return {
    llmModels: result.llmModels ?? [],
    imageModels: result.imageModels ?? [],
  };
}
