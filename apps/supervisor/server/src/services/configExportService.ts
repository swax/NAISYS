import {
  dbFieldsToImageModel,
  dbFieldsToLlmModel,
  type ModelDbRow,
} from "@naisys/common";
import yaml from "js-yaml";

export interface ExportUserRow {
  id: number;
  username: string;
  title: string;
  config: string;
  lead_user_id: number | null;
  archived: boolean;
}

export interface ExportVariableRow {
  key: string;
  value: string;
}

export interface ExportFile {
  path: string;
  content: string;
}

function toKebabCase(str: string): string {
  return str
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/gi, "")
    .toLowerCase();
}

function agentFileName(user: ExportUserRow): string {
  return toKebabCase(user.title || user.username);
}

export function buildExportFiles(
  users: ExportUserRow[],
  variables: ExportVariableRow[],
  modelRows: ModelDbRow[],
): ExportFile[] {
  const files: ExportFile[] = [];

  // --- Agents ---
  const activeUsers = users.filter(
    (u) => u.username !== "admin" && !u.archived,
  );

  const userById = new Map(activeUsers.map((u) => [u.id, u]));

  // Walk up ancestor chain to build full directory path
  function agentDirPath(user: ExportUserRow): string {
    const segments: string[] = [];
    let current = user.lead_user_id
      ? userById.get(user.lead_user_id)
      : undefined;
    while (current) {
      segments.unshift(agentFileName(current));
      current = current.lead_user_id
        ? userById.get(current.lead_user_id)
        : undefined;
    }
    return ["agents", ...segments].join("/");
  }

  for (const user of activeUsers) {
    const filePath = `${agentDirPath(user)}/${agentFileName(user)}.yaml`;
    files.push({ path: filePath, content: user.config });
  }

  // --- Variables ---
  if (variables.length > 0) {
    const envContent = variables.map((v) => `${v.key}=${v.value}`).join("\n");
    files.push({ path: ".env", content: envContent + "\n" });
  }

  // --- Custom models ---
  const customModels = modelRows.filter((r) => r.is_custom);
  if (customModels.length > 0) {
    const llmRows = customModels.filter((r) => r.type === "llm");
    const imageRows = customModels.filter((r) => r.type === "image");

    const output: Record<string, unknown> = {};
    if (llmRows.length > 0) {
      output.llmModels = llmRows.map(dbFieldsToLlmModel);
    }
    if (imageRows.length > 0) {
      output.imageModels = imageRows.map(dbFieldsToImageModel);
    }

    const yamlStr = yaml.dump(output, { lineWidth: -1 });
    files.push({ path: "custom-models.yaml", content: yamlStr });
  }

  return files;
}
