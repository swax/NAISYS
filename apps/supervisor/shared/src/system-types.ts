import { z } from "zod";

export const MonitorModeSchema = z.enum(["monitor-naisys", "monitor-hub"]);

export const MonitorModeResponseSchema = z.object({
  success: z.literal(true),
  monitorMode: MonitorModeSchema,
});

export type MonitorMode = z.infer<typeof MonitorModeSchema>;
export type MonitorModeResponse = z.infer<typeof MonitorModeResponseSchema>;
