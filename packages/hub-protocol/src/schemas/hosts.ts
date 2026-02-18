import { z } from "zod";

/** Pushed from hub to all NAISYS instances when the set of known hosts changes */
export const HostListSchema = z.object({
  hosts: z.array(
    z.object({
      hostId: z.number(),
      hostName: z.string(),
      online: z.boolean(),
    }),
  ),
});
export type HostList = z.infer<typeof HostListSchema>;
