import { z } from "zod";

export const HostTypeEnum = z.enum(["naisys", "supervisor"]);
export type HostType = z.infer<typeof HostTypeEnum>;

/** Pushed from hub to all NAISYS instances when the set of known hosts changes */
export const HostListSchema = z.object({
  hubVersion: z.string(),
  hosts: z.array(
    z.object({
      hostId: z.number(),
      hostName: z.string(),
      restricted: z.boolean(),
      hostType: HostTypeEnum,
      online: z.boolean(),
      version: z.string(),
    }),
  ),
});
export type HostList = z.infer<typeof HostListSchema>;
