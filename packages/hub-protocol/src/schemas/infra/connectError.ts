import { z } from "zod";

export const HubConnectErrorCodeSchema = z.enum([
  "invalid_access_key",
  "missing_host_name",
  "superseded_by_newer_instance",
  "registration_failed",
]);
export type HubConnectErrorCode = z.infer<typeof HubConnectErrorCodeSchema>;

/** Structured Socket.IO handshake error metadata returned in connect_error.data */
export const HubConnectErrorDataSchema = z.object({
  code: HubConnectErrorCodeSchema,
  fatal: z.boolean(),
});
export type HubConnectErrorData = z.infer<typeof HubConnectErrorDataSchema>;
