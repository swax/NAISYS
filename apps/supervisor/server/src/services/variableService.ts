import { hubDb } from "../database/hubDb.js";

// Reserved at the agent shell — set by the runtime, not editable as a variable.
const RESERVED_VARIABLE_KEYS = new Set(["NAISYS_API_KEY"]);

const VARIABLE_CACHE_TTL_MS = 10_000;
const variableCache = new Map<
  string,
  { value: string | undefined; expiresAt: number }
>();

export async function getVariables() {
  return hubDb.variables.findMany({ orderBy: { key: "asc" } });
}

export async function getVariableValue(
  key: string,
): Promise<string | undefined> {
  const v = await hubDb.variables.findUnique({ where: { key } });
  return v?.value;
}

/** Like getVariableValue but with a short in-process TTL cache. Invalidated on save/delete. */
export async function getVariableCachedValue(
  key: string,
): Promise<string | undefined> {
  const now = Date.now();
  const cached = variableCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await getVariableValue(key);
  variableCache.set(key, { value, expiresAt: now + VARIABLE_CACHE_TTL_MS });
  return value;
}

export async function saveVariable(
  key: string,
  value: string,
  exportToShell: boolean,
  sensitive: boolean,
  userUuid: string,
): Promise<{ success: boolean; message: string }> {
  if (RESERVED_VARIABLE_KEYS.has(key)) {
    throw new Error(`'${key}' is reserved and cannot be set as a variable`);
  }
  await hubDb.variables.upsert({
    where: { key },
    update: {
      value,
      export_to_shell: exportToShell,
      sensitive,
      updated_by: userUuid,
    },
    create: {
      key,
      value,
      export_to_shell: exportToShell,
      sensitive,
      created_by: userUuid,
      updated_by: userUuid,
    },
  });
  variableCache.delete(key);
  return { success: true, message: "Variable saved" };
}

export async function deleteVariable(
  key: string,
): Promise<{ success: boolean; message: string }> {
  await hubDb.variables.delete({ where: { key } });
  variableCache.delete(key);
  return { success: true, message: "Variable deleted" };
}
