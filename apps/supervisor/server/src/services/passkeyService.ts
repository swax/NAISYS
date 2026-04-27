import {
  consumeTokenAndStoreCredential,
  createPasskeyCredential,
  findPasskeyCredentialByCredentialId,
  issueRegistrationToken,
  listPasskeyCredentialIdsForUser,
  lookupRegistrationToken,
  updatePasskeyCounter,
} from "@naisys/supervisor-database";
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { FastifyRequest } from "fastify";

import { getUserById } from "./userService.js";

const RP_NAME = "NAISYS Supervisor";
const REGISTRATION_PATH = "/supervisor/register";

/**
 * Optional hardening: when set, lock the WebAuthn relying-party identity to
 * static values instead of deriving them from request headers. Without these,
 * a misconfigured reverse proxy that forwards an attacker-controlled Host or
 * Origin could trick the verifier into matching the wrong RP.
 *
 *   SUPERVISOR_WEBAUTHN_RP_ID   e.g. "supervisor.example.com"
 *   SUPERVISOR_WEBAUTHN_ORIGIN  e.g. "https://supervisor.example.com"
 *                                    (or comma-separated for dev + prod)
 *
 * If unset we fall back to deriving from the request — convenient for local
 * dev where the host changes between localhost / 127.0.0.1 / lan IPs.
 */
const RP_ID_OVERRIDE = process.env.SUPERVISOR_WEBAUTHN_RP_ID?.trim() || null;
const ORIGIN_OVERRIDE_RAW =
  process.env.SUPERVISOR_WEBAUTHN_ORIGIN?.trim() || null;
const ORIGIN_OVERRIDES: string[] | null = ORIGIN_OVERRIDE_RAW
  ? ORIGIN_OVERRIDE_RAW.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

/**
 * Derive the WebAuthn relying-party ID. Honors the env override when set;
 * otherwise pulls from the request host. RP ID is a domain (or "localhost")
 * with no port.
 */
export function rpIdFromHost(hostHeader: string | undefined): string {
  if (RP_ID_OVERRIDE) return RP_ID_OVERRIDE;
  const host = (hostHeader ?? "localhost").split(":")[0];
  return host || "localhost";
}

/**
 * Origin used to *advertise* the supervisor for tasks like registration URLs.
 * Always returns a single string — when the env override defines multiple
 * origins, we use the first as the canonical one.
 */
export function originFromRequest(opts: {
  hostHeader: string | undefined;
  protocol: string;
}): string {
  if (ORIGIN_OVERRIDES && ORIGIN_OVERRIDES.length > 0) {
    return ORIGIN_OVERRIDES[0];
  }
  const host = opts.hostHeader ?? "localhost";
  return `${opts.protocol}://${host}`;
}

/**
 * The origin(s) the operator pinned via SUPERVISOR_WEBAUTHN_ORIGIN, or null
 * if unset. Returning a distinct null lets callers tell "the operator
 * configured this exact value" apart from "we derived something from
 * headers" — important because the WebAuthn verifier accepts both
 * `string` and `string[]`, so a single-value override would otherwise be
 * indistinguishable from a request-derived fallback.
 */
export function configuredExpectedOrigin(): string | string[] | null {
  if (!ORIGIN_OVERRIDES || ORIGIN_OVERRIDES.length === 0) return null;
  return ORIGIN_OVERRIDES.length === 1 ? ORIGIN_OVERRIDES[0] : ORIGIN_OVERRIDES;
}

/**
 * Resolve the expected origin for WebAuthn verification:
 *   1. The env override (locks down regardless of request headers), else
 *   2. The browser-supplied Origin header, else
 *   3. A best-effort derivation from the request's protocol + host header.
 */
export function getExpectedOrigin(
  request: FastifyRequest,
): string | string[] {
  const configured = configuredExpectedOrigin();
  if (configured !== null) return configured;
  const originHeader = request.headers.origin;
  if (typeof originHeader === "string" && originHeader) return originHeader;
  return originFromRequest({
    protocol: request.protocol,
    hostHeader: request.headers.host,
  });
}

export function buildRegistrationUrl(opts: {
  protocol: string;
  hostHeader: string | undefined;
  token: string;
}): string {
  return `${originFromRequest({ protocol: opts.protocol, hostHeader: opts.hostHeader })}${REGISTRATION_PATH}?token=${encodeURIComponent(opts.token)}`;
}

export async function generatePasskeyRegistrationOptions(input: {
  userId: number;
  username: string;
  rpId: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await listPasskeyCredentialIdsForUser(input.userId);
  return await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: input.rpId,
    userName: input.username,
    userID: new TextEncoder().encode(String(input.userId)),
    attestationType: "none",
    authenticatorSelection: {
      // Required (not preferred) so that login with allowCredentials:[]
      // can find the credential — non-discoverable credentials would never
      // surface in our usernameless login flow.
      residentKey: "required",
      // Required (not preferred) so a biometric/PIN gesture is mandatory at
      // every authentication. Prevents silent unlock by anything that's
      // captured the device but not the user.
      userVerification: "required",
    },
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
  });
}

export async function generatePasskeyAuthenticationOptions(
  rpId: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return await generateAuthenticationOptions({
    rpID: rpId,
    // Required (not preferred): every login must include a biometric/PIN
    // gesture. Matches the registration policy; prevents silent assertions
    // from a compromised device.
    userVerification: "required",
    // Empty allowCredentials lets the browser show all discoverable passkeys
    // for this RP — usernameless login.
    allowCredentials: [],
  });
}

/**
 * Step-up assertion options: scopes the prompt to *this user's* registered
 * credentials so the browser only offers their own passkeys. Returns null
 * when the user has none — callers should treat that as "no step-up
 * possible" rather than synthesizing fake options.
 */
export async function generatePasskeyStepUpOptions(input: {
  userId: number;
  rpId: string;
}): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const credentials = await listPasskeyCredentialIdsForUser(input.userId);
  if (credentials.length === 0) return null;
  return await generateAuthenticationOptions({
    rpID: input.rpId,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
      transports: parseTransports(c.transports),
    })),
  });
}

export interface VerifyRegistrationInput {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string | string[];
  expectedRPID: string;
}

export interface VerifiedRegistration {
  credentialId: string;
  /** Base64url-encoded public key, ready to persist. */
  publicKey: string;
  counter: number;
  transports: string[];
}

/**
 * Crypto-verify a WebAuthn registration response without writing anything to
 * the database. Callers decide how to persist the resulting credential —
 * see `consumeTokenAndStoreCredential` for the token path or
 * `createPasskeyCredential` for the authenticated-add-another path.
 */
export async function verifyRegistration(
  input: VerifyRegistrationInput,
): Promise<VerifiedRegistration | null> {
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRPID,
  });

  if (!verification.verified || !verification.registrationInfo) return null;

  const { credential } = verification.registrationInfo;
  return {
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: input.response.response.transports ?? [],
  };
}

/** Authenticated path: store a verified credential against the current user. */
export async function storeVerifiedCredentialForUser(input: {
  userId: number;
  verified: VerifiedRegistration;
  deviceLabel?: string;
}): Promise<void> {
  await createPasskeyCredential({
    userId: input.userId,
    credentialId: input.verified.credentialId,
    publicKey: input.verified.publicKey,
    counter: input.verified.counter,
    transports: input.verified.transports,
    deviceLabel: input.deviceLabel,
  });
}

/**
 * Token path: consume the registration token and store the verified
 * credential atomically. Returns the target user when the token was valid
 * and freshly consumed; null if the token was already used / expired /
 * unknown (the credential is NOT stored in that case).
 */
export async function consumeTokenAndStoreVerifiedCredential(input: {
  token: string;
  verified: VerifiedRegistration;
  deviceLabel?: string;
}): Promise<{ userId: number; username: string } | null> {
  return consumeTokenAndStoreCredential({
    token: input.token,
    credentialId: input.verified.credentialId,
    publicKey: input.verified.publicKey,
    counter: input.verified.counter,
    transports: input.verified.transports,
    deviceLabel: input.deviceLabel,
  });
}

export interface VerifyAuthenticationInput {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string | string[];
  expectedRPID: string;
}

export interface VerifyAuthenticationResult {
  verified: boolean;
  userId?: number;
  username?: string;
}

export async function verifyAuthentication(
  input: VerifyAuthenticationInput,
): Promise<VerifyAuthenticationResult> {
  const credentialId = input.response.id;
  const stored = await findPasskeyCredentialByCredentialId(credentialId);
  if (!stored) return { verified: false };

  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: input.expectedChallenge,
    expectedOrigin: input.expectedOrigin,
    expectedRPID: input.expectedRPID,
    credential: {
      id: stored.credentialId,
      publicKey: isoBase64URL.toBuffer(stored.publicKey),
      counter: stored.counter,
      transports: parseTransports(stored.transports),
    },
  });

  if (!verification.verified) return { verified: false };

  await updatePasskeyCounter(
    stored.credentialId,
    verification.authenticationInfo.newCounter,
  );

  return {
    verified: true,
    userId: stored.userId,
    username: stored.username,
  };
}

function parseTransports(
  raw: string,
): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").filter(Boolean) as AuthenticatorTransportFuture[];
}

export { issueRegistrationToken, lookupRegistrationToken };

/**
 * Convenience used by setup flow + user create: issue a token + log a friendly
 * URL the operator can paste into a browser.
 */
export async function issueRegistrationLink(opts: {
  userId: number;
  protocol: string;
  hostHeader: string | undefined;
}): Promise<{ url: string; expiresAt: Date; token: string }> {
  const { token, expiresAt } = await issueRegistrationToken(opts.userId);
  const url = buildRegistrationUrl({
    protocol: opts.protocol,
    hostHeader: opts.hostHeader,
    token,
  });
  return { url, expiresAt, token };
}

export async function getUserForRegistrationToken(token: string): Promise<
  | {
      userId: number;
      username: string;
    }
  | null
> {
  const lookup = await lookupRegistrationToken(token);
  if (!lookup) return null;
  // Verify the user record still exists (in case it was deleted).
  const user = await getUserById(lookup.userId);
  if (!user) return null;
  return { userId: lookup.userId, username: lookup.username };
}
