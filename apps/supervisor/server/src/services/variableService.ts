import { hubDb } from "../database/hubDb.js";

export async function getVariables() {
  return hubDb.variables.findMany({ orderBy: { key: "asc" } });
}

export async function saveVariable(
  key: string,
  value: string,
  exportToShell: boolean,
  userUuid: string,
): Promise<{ success: boolean; message: string }> {
  await hubDb.variables.upsert({
    where: { key },
    update: { value, export_to_shell: exportToShell, updated_by: userUuid },
    create: {
      key,
      value,
      export_to_shell: exportToShell,
      created_by: userUuid,
      updated_by: userUuid,
    },
  });
  return { success: true, message: "Variable saved" };
}

export async function deleteVariable(
  key: string,
): Promise<{ success: boolean; message: string }> {
  await hubDb.variables.delete({ where: { key } });
  return { success: true, message: "Variable deleted" };
}
