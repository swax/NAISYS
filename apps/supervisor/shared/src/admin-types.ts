import { HateoasActionSchema } from "@naisys/common";
import { z } from "zod";

export const AdminInfoResponseSchema = z.object({
  supervisorDbPath: z.string(),
  hubDbPath: z.string(),
  hubConnected: z.boolean(),
  hubAccessKey: z.string().optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type AdminInfoResponse = z.infer<typeof AdminInfoResponseSchema>;
