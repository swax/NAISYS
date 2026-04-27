import { z } from "zod";

export const AuthUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  permissions: z.array(z.string()),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const LogoutResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

// --- Passkey (WebAuthn) ---
//
// We don't validate the inner shape of the WebAuthn options/responses on the
// wire — they're large nested objects defined by the WebAuthn spec and
// produced/consumed by @simplewebauthn. Treat them as opaque pass-through
// payloads here; the server library does the structural validation.

export const PasskeyAuthenticationOptionsSchema = z.object({
  options: z.any(),
});
export type PasskeyAuthenticationOptions = z.infer<
  typeof PasskeyAuthenticationOptionsSchema
>;

export const PasskeyAuthenticationVerifySchema = z
  .object({
    response: z.any(),
  })
  .strict();
export type PasskeyAuthenticationVerify = z.infer<
  typeof PasskeyAuthenticationVerifySchema
>;

export const PasskeyRegistrationOptionsRequestSchema = z
  .object({
    /** Required when the caller is not already authenticated. */
    token: z.string().optional(),
    /**
     * Step-up assertion required for authenticated callers adding an
     * additional passkey. Ignored on the token path (the token itself is
     * the authorization proof).
     */
    stepUpAssertion: z.any().optional(),
  })
  .strict();
export type PasskeyRegistrationOptionsRequest = z.infer<
  typeof PasskeyRegistrationOptionsRequestSchema
>;

export const PasskeyRegistrationOptionsSchema = z.object({
  username: z.string(),
  options: z.any(),
});
export type PasskeyRegistrationOptionsResponse = z.infer<
  typeof PasskeyRegistrationOptionsSchema
>;

export const PasskeyRegistrationVerifySchema = z
  .object({
    token: z.string().optional(),
    response: z.any(),
    deviceLabel: z.string().max(64).optional(),
  })
  .strict();
export type PasskeyRegistrationVerify = z.infer<
  typeof PasskeyRegistrationVerifySchema
>;

export const PasskeyRegistrationVerifyResponseSchema = z.object({
  success: z.boolean(),
  /** Set when the verify request consumed a registration token (signed-in via passkey). */
  user: AuthUserSchema.optional(),
});
export type PasskeyRegistrationVerifyResponse = z.infer<
  typeof PasskeyRegistrationVerifyResponseSchema
>;

export const PasskeyCredentialSchema = z.object({
  id: z.number(),
  deviceLabel: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type PasskeyCredential = z.infer<typeof PasskeyCredentialSchema>;

export const PasskeyCredentialListSchema = z.object({
  credentials: z.array(PasskeyCredentialSchema),
});
export type PasskeyCredentialList = z.infer<typeof PasskeyCredentialListSchema>;

export const PasskeyRenameRequestSchema = z
  .object({
    deviceLabel: z.string().max(64),
  })
  .strict();
export type PasskeyRenameRequest = z.infer<typeof PasskeyRenameRequestSchema>;

export const RegistrationTokenResponseSchema = z.object({
  username: z.string(),
  registrationUrl: z.string(),
  expiresAt: z.string(),
});
export type RegistrationTokenResponse = z.infer<
  typeof RegistrationTokenResponseSchema
>;

/** Validate-only response for the public registration-token lookup endpoint. */
export const RegistrationTokenLookupResponseSchema = z.object({
  username: z.string(),
});
export type RegistrationTokenLookupResponse = z.infer<
  typeof RegistrationTokenLookupResponseSchema
>;

/**
 * Step-up auth: a fresh passkey assertion required to authorize sensitive
 * actions (issuing registration links, wiping passkeys, creating users).
 * Defends against session-cookie hijack by re-proving "the human is here."
 *
 * `needsStepUp: false` means the caller has no passkey on file — the only
 * case where step-up is silently skipped (otherwise they'd be locked out of
 * actions they can perform with no second factor available).
 */
export const StepUpOptionsResponseSchema = z.object({
  needsStepUp: z.boolean(),
  options: z.any().optional(),
});
export type StepUpOptionsResponse = z.infer<typeof StepUpOptionsResponseSchema>;

/**
 * Body shape accepted by every step-up-gated endpoint. The assertion is
 * passed through opaquely; the simplewebauthn server library validates it.
 */
export const StepUpAssertionBodySchema = z
  .object({
    stepUpAssertion: z.any().optional(),
  })
  .strict();
export type StepUpAssertionBody = z.infer<typeof StepUpAssertionBodySchema>;
