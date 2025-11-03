import { Settings } from "shared";
import {
  selectFromOverlordDb,
  runOnOverlordDb,
} from "../database/overlordDatabase.js";

export interface SettingsRecord {
  id: number;
  settings_json: string;
  modify_date: string;
  read_status_json: string;
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!settings || typeof settings.naisysDataFolderPath !== "string") {
    throw new Error("Invalid settings format");
  }

  await runOnOverlordDb(
    `
    INSERT OR REPLACE INTO settings (id, settings_json, modify_date)
    VALUES (1, ?, ?)
  `,
    [JSON.stringify(settings), new Date().toISOString()],
  );
}

export async function getSettings(): Promise<Settings | null> {
  const settingsRecords = await selectFromOverlordDb<SettingsRecord[] | null>(`
    SELECT id, settings_json, modify_date, read_status_json
    FROM settings 
    WHERE id = 1
  `);

  if (!settingsRecords?.length) {
    return null;
  }

  return JSON.parse(settingsRecords[0].settings_json) as Settings;
}
