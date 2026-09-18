import {
  builtInImageModels,
  builtInLlmModels,
  dbFieldsToImageModel,
  dbFieldsToLlmModel,
  findLlmModel,
  type ImageModel,
  imageModelToDbFields,
  type LlmModel,
  llmModelToDbFields,
  type ModelDbRow,
  validateLlmModelAliases,
  withBuiltInImageAliases,
  withBuiltInLlmAliases,
} from "@naisys/common";

import { hubDb } from "../database/hubDb.js";

export async function getAllModelsFromDb(): Promise<ModelDbRow[]> {
  return hubDb.models.findMany();
}

export async function saveLlmModel(model: LlmModel): Promise<{
  success: boolean;
  message: string;
}> {
  await hubDb.$transaction(async (db) => {
    const rows = (await db.models.findMany()) as ModelDbRow[];
    const models = rows.filter((r) => r.type === "llm").map(dbFieldsToLlmModel);
    const resolved = findLlmModel(models, model.key);
    const canonical = withBuiltInLlmAliases({
      ...model,
      key: resolved?.key ?? model.key,
    });
    validateLlmModelAliases([
      ...models.filter((m) => m.key !== canonical.key),
      ...rows.filter((r) => r.type === "image").map(dbFieldsToImageModel),
      canonical,
    ]);
    const existing = rows.find((r) => r.key === canonical.key);
    const fields = llmModelToDbFields(
      canonical,
      existing?.is_builtin ?? false,
      true,
    );
    await db.models.upsert({
      where: { key: canonical.key },
      update: fields,
      create: fields,
    });
  });

  return { success: true, message: "LLM model saved" };
}

export async function saveImageModel(model: ImageModel): Promise<{
  success: boolean;
  message: string;
}> {
  await hubDb.$transaction(async (db) => {
    const rows = (await db.models.findMany()) as ModelDbRow[];
    const models = rows
      .filter((r) => r.type === "image")
      .map(dbFieldsToImageModel);
    const resolved = findLlmModel(models, model.key);
    const canonical = withBuiltInImageAliases({
      ...model,
      key: resolved?.key ?? model.key,
    });
    validateLlmModelAliases([
      ...models.filter((m) => m.key !== canonical.key),
      ...rows.filter((r) => r.type === "llm").map(dbFieldsToLlmModel),
      canonical,
    ]);
    const existing = rows.find((r) => r.key === canonical.key);
    const fields = imageModelToDbFields(
      canonical,
      existing?.is_builtin ?? false,
      true,
    );
    await db.models.upsert({
      where: { key: canonical.key },
      update: fields,
      create: fields,
    });
  });

  return { success: true, message: "Image model saved" };
}

export async function deleteLlmModel(key: string): Promise<{
  success: boolean;
  message: string;
  revertedToBuiltIn: boolean;
}> {
  const rows = (await hubDb.models.findMany({
    where: { type: "llm" },
  })) as ModelDbRow[];
  key = findLlmModel(rows.map(dbFieldsToLlmModel), key)?.key ?? key;
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
  const rows = (await hubDb.models.findMany({
    where: { type: "image" },
  })) as ModelDbRow[];
  key = findLlmModel(rows.map(dbFieldsToImageModel), key)?.key ?? key;
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
