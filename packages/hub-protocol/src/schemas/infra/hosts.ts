import { z } from "zod";

export const HostTypeEnum = z.enum(["naisys", "supervisor"]);
export type HostType = z.infer<typeof HostTypeEnum>;

/** Sent from hub to a freshly-authenticated client with its resolved identity */
export const HostRegisteredSchema = z.object({
  hostId: z.number(),
  hostName: z.string(),
});
export type HostRegistered = z.infer<typeof HostRegisteredSchema>;

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

/**
 * Request to terminate the NAISYS client process on a host.
 * Supervisor → Hub → target NAISYS (two-hop relay). The hub routes by
 * `hostId`; the target host ignores it (it can only terminate itself).
 */
export const HostTerminateRequestSchema = z.object({
  /** The host whose NAISYS process should exit. */
  hostId: z.number(),
  /** Connection that initiated the request (the supervisor). */
  sourceHostId: z.number().optional(),
});
export type HostTerminateRequest = z.infer<typeof HostTerminateRequestSchema>;

/** Response to a host terminate request */
export const HostTerminateResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type HostTerminateResponse = z.infer<typeof HostTerminateResponseSchema>;
