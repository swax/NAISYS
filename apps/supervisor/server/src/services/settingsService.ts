import { Settings } from "@naisys-supervisor/shared";
import prisma from "../db.js";
import { cachedForSeconds } from "../utils/cache.js";

export async function saveSettings(settings: Settings): Promise<void> {
  if (!settings || typeof settings.example !== "string") {
    throw new Error("Invalid settings format");
  }

  await prisma.setting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      settingsJson: JSON.stringify(settings),
      modifyDate: new Date().toISOString(),
    },
    update: {
      settingsJson: JSON.stringify(settings),
      modifyDate: new Date().toISOString(),
    },
  });
}

export const getSettings = cachedForSeconds(
  1,
  async (): Promise<Settings | null> => {
    const record = await prisma.setting.findUnique({ where: { id: 1 } });

    if (!record) {
      return null;
    }

    return JSON.parse(record.settingsJson) as Settings;
  },
);
