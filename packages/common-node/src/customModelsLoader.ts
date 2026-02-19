import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { CustomModelsFileSchema, type CustomModelsFile } from "@naisys/common";

export function loadCustomModels(folder: string): CustomModelsFile {
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

export function saveCustomModels(data: CustomModelsFile): void {
  const folder = process.env.NAISYS_FOLDER;
  if (!folder) {
    throw new Error("NAISYS_FOLDER environment variable is not set");
  }

  // Validate before writing
  CustomModelsFileSchema.parse(data);

  // Omit empty arrays from output
  const output: Record<string, unknown> = {};
  if (data.llmModels && data.llmModels.length > 0) {
    output.llmModels = data.llmModels;
  }
  if (data.imageModels && data.imageModels.length > 0) {
    output.imageModels = data.imageModels;
  }

  const filePath = path.join(folder, "custom-models.yaml");
  const yamlStr = yaml.dump(output, { lineWidth: -1 });
  fs.writeFileSync(filePath, yamlStr, "utf-8");
}
