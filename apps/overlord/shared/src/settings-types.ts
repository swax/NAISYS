import { z } from "zod";

export const SettingsSchema = z.object({
  naisysDataFolderPath: z.string(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export interface SettingsRequest {
  settings: Settings;
}

export interface SettingsResponse {
  success: boolean;
  message: string;
  settings?: Settings;
}
