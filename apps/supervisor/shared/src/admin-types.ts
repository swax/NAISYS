import { HateoasActionSchema } from "@naisys/common";
import { z } from "zod";

export const AdminInfoResponseSchema = z.object({
  supervisorDbPath: z.string(),
  supervisorDbSize: z.number().optional(),
  hubDbPath: z.string(),
  hubDbSize: z.number().optional(),
  hubConnected: z.boolean(),
  hubAccessKey: z.string().optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type AdminInfoResponse = z.infer<typeof AdminInfoResponseSchema>;
