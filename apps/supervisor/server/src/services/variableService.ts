import { usingNaisysDb } from "../database/naisysDatabase.js";

export async function getVariables() {
  return usingNaisysDb((prisma) =>
    prisma.variables.findMany({ orderBy: { key: "asc" } }),
  );
}

export async function saveVariable(
  key: string,
  value: string,
  userUuid: string,
): Promise<{ success: boolean; message: string }> {
  await usingNaisysDb((prisma) =>
    prisma.variables.upsert({
      where: { key },
      update: { value, updated_by: userUuid },
      create: { key, value, created_by: userUuid, updated_by: userUuid },
    }),
  );
  return { success: true, message: "Variable saved" };
}

export async function deleteVariable(
  key: string,
): Promise<{ success: boolean; message: string }> {
  await usingNaisysDb((prisma) => prisma.variables.delete({ where: { key } }));
  return { success: true, message: "Variable deleted" };
}
