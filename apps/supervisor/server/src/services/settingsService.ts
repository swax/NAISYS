import { Settings } from "@naisys-supervisor/shared";
import {
  selectFromSupervisorDb,
  runOnSupervisorDb,
} from "../database/supervisorDatabase.js";
import { cachedForSeconds } from "../utils/cache.js";

export interface SettingsRecord {
  id: number;
  settings_json: string;
  modify_date: string;
  read_status_json: string;
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!settings || typeof settings.example !== "string") {
    throw new Error("Invalid settings format");
  }

  await runOnSupervisorDb(
    `
    INSERT OR REPLACE INTO settings (id, settings_json, modify_date)
    VALUES (1, ?, ?)
  `,
    [JSON.stringify(settings), new Date().toISOString()],
  );
}

export const getSettings = cachedForSeconds(
  1,
  async (): Promise<Settings | null> => {
    const settingsRecords = await selectFromSupervisorDb<
      SettingsRecord[] | null
    >(`
    SELECT id, settings_json, modify_date, read_status_json
    FROM settings
    WHERE id = 1
  `);

    if (!settingsRecords?.length) {
      return null;
    }

    return JSON.parse(settingsRecords[0].settings_json) as Settings;
  },
);
