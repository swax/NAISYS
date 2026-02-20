import {
  builtInLlmModels,
  builtInImageModels,
  llmModelToDbFields,
  imageModelToDbFields,
  type LlmModel,
  type ImageModel,
  type ModelDbRow,
} from "@naisys/common";
import { hubDb } from "../database/hubDb.js";

export async function getAllModelsFromDb(): Promise<ModelDbRow[]> {
  return hubDb.models.findMany();
}

export async function saveLlmModel(model: LlmModel): Promise<{
  success: boolean;
  message: string;
}> {
  const fields = llmModelToDbFields(model, false, true);

  const existing = await hubDb.models.findUnique({
    where: { key: model.key },
  });

  if (existing) {
    await hubDb.models.update({
      where: { key: model.key },
      data: { ...fields, is_builtin: existing.is_builtin, is_custom: true },
    });
  } else {
    await hubDb.models.create({ data: fields });
  }

  return { success: true, message: "LLM model saved" };
}

export async function saveImageModel(model: ImageModel): Promise<{
  success: boolean;
  message: string;
}> {
  const fields = imageModelToDbFields(model, false, true);

  const existing = await hubDb.models.findUnique({
    where: { key: model.key },
  });

  if (existing) {
    await hubDb.models.update({
      where: { key: model.key },
      data: { ...fields, is_builtin: existing.is_builtin, is_custom: true },
    });
  } else {
    await hubDb.models.create({ data: fields });
  }

  return { success: true, message: "Image model saved" };
}

export async function deleteLlmModel(key: string): Promise<{
  success: boolean;
  message: string;
  revertedToBuiltIn: boolean;
}> {
  const existing = await hubDb.models.findUnique({ where: { key } });

  if (!existing || existing.type !== "llm") {
    return {
      success: false,
      message: "Model not found",
      revertedToBuiltIn: false,
    };
  }

  if (existing.is_builtin) {
    // Reset to built-in defaults
    const builtIn = builtInLlmModels.find((m) => m.key === key)!;
    const fields = llmModelToDbFields(builtIn, true, false);
    await hubDb.models.update({ where: { key }, data: fields });
    return {
      success: true,
      message: "Custom override removed, reverted to built-in",
      revertedToBuiltIn: true,
    };
  }

  await hubDb.models.delete({ where: { key } });
  return {
    success: true,
    message: "Custom model deleted",
    revertedToBuiltIn: false,
  };
}

export async function deleteImageModel(key: string): Promise<{
  success: boolean;
  message: string;
  revertedToBuiltIn: boolean;
}> {
  const existing = await hubDb.models.findUnique({ where: { key } });

  if (!existing || existing.type !== "image") {
    return {
      success: false,
      message: "Model not found",
      revertedToBuiltIn: false,
    };
  }

  if (existing.is_builtin) {
    // Reset to built-in defaults
    const builtIn = builtInImageModels.find((m) => m.key === key)!;
    const fields = imageModelToDbFields(builtIn, true, false);
    await hubDb.models.update({ where: { key }, data: fields });
    return {
      success: true,
      message: "Custom override removed, reverted to built-in",
      revertedToBuiltIn: true,
    };
  }

  await hubDb.models.delete({ where: { key } });
  return {
    success: true,
    message: "Custom model deleted",
    revertedToBuiltIn: false,
  };
}
