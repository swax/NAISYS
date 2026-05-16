import { z } from "zod";

/** Request to mint an OpenAI Codex OAuth access token. */
export const CodexAccessTokenRequestSchema = z.object({
  /** Drop the hub's cached token before responding. Used after the caller observed an auth failure with the prior token. */
  forceRefresh: z.boolean().optional(),
});
export type CodexAccessTokenRequest = z.infer<
  typeof CodexAccessTokenRequestSchema
>;

/** Response carrying a fresh OpenAI Codex OAuth access token, or an error. */
export const CodexAccessTokenResponseSchema = z.object({
  success: z.boolean(),
  accessToken: z.string().optional(),
  /** Unix epoch milliseconds when the access token expires. Present on success. */
  expiresAt: z.number().optional(),
  error: z.string().optional(),
});
export type CodexAccessTokenResponse = z.infer<
  typeof CodexAccessTokenResponseSchema
>;
