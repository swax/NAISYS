import type {
  AuthUser,
  LogoutResponse,
  PasskeyAuthenticationOptions,
  PasskeyAuthenticationVerify,
  PasskeyCredentialList,
  PasskeyRegistrationOptionsRequest,
  PasskeyRegistrationOptionsResponse,
  PasskeyRegistrationVerify,
  PasskeyRegistrationVerifyResponse,
  PasswordLoginRequest,
  PasswordRegistrationRequest,
  PasswordRegistrationResponse,
  PasswordVerifyRequest,
  PasswordVerifyResponse,
  RegistrationTokenLookupResponse,
  RegistrationTokenResponse,
  StepUpAssertionBody,
  StepUpOptionsResponse,
  UserActionResult,
} from "@naisys/supervisor-shared";
import {
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import { api, apiEndpoints } from "./apiClient";

type StepUpPasswordPrompt = () => Promise<string | null>;

let stepUpPasswordPrompt: StepUpPasswordPrompt | null = null;

export function setStepUpPasswordPrompt(
  prompt: StepUpPasswordPrompt | null,
): void {
  stepUpPasswordPrompt = prompt;
}

export const getMe = async (): Promise<AuthUser> => {
  return await api.get<AuthUser>(apiEndpoints.me);
};

export const logout = async (): Promise<LogoutResponse> => {
  return await api.post<{}, LogoutResponse>(apiEndpoints.logout, {});
};

/**
 * Run a passkey sign-in. Lets the browser pick from any discoverable passkey
 * registered for this RP — no username required.
 */
export const passkeyLogin = async (): Promise<{ user: AuthUser }> => {
  const { options } = await api.post<{}, PasskeyAuthenticationOptions>(
    apiEndpoints.passkeyLoginOptions,
    {},
  );
  const response = await runPasskeyCeremony(
    () =>
      startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      }),
    "Passkey sign-in was canceled or timed out.",
  );
  const user = await api.post<PasskeyAuthenticationVerify, AuthUser>(
    apiEndpoints.passkeyLoginVerify,
    { response },
  );
  return { user };
};

export const passwordLogin = async (input: {
  username: string;
  password: string;
}): Promise<{ user: AuthUser }> => {
  const user = await api.post<PasswordLoginRequest, AuthUser>(
    apiEndpoints.passwordLogin,
    input,
  );
  return { user };
};

/**
 * Register a passkey. Pass `token` when bootstrapping a new account from a
 * one-time registration link; omit it to add an additional passkey to the
 * already signed-in account.
 *
 * The authenticated path (no token) runs a step-up assertion first so a
 * hijacked session cookie can't silently mint a new credential. The server
 * also rejects this path entirely when the caller has zero passkeys —
 * first-passkey enrollment must come through a registration link.
 */
export const passkeyRegister = async (input: {
  token?: string;
  deviceLabel?: string;
}): Promise<PasskeyRegistrationVerifyResponse> => {
  const stepUp = input.token ? {} : await performStepUp();

  const { options, username } = await api.post<
    PasskeyRegistrationOptionsRequest,
    PasskeyRegistrationOptionsResponse
  >(apiEndpoints.passkeyRegisterOptions, {
    token: input.token,
    stepUpAssertion: stepUp.stepUpAssertion,
  });

  const response = await runPasskeyCeremony(
    () =>
      startRegistration({
        optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
      }),
    "Passkey registration was canceled or timed out.",
  );

  return await api.post<
    PasskeyRegistrationVerify,
    PasskeyRegistrationVerifyResponse
  >(apiEndpoints.passkeyRegisterVerify, {
    token: input.token,
    response,
    deviceLabel: input.deviceLabel ?? defaultDeviceLabel(username),
  });
};

export const passwordRegister = async (input: {
  token: string;
  password: string;
}): Promise<PasswordRegistrationResponse> => {
  return await api.post<
    PasswordRegistrationRequest,
    PasswordRegistrationResponse
  >(apiEndpoints.passwordRegister, input);
};

/** Pre-flight verify the current user's password (for the step-up modal). */
export const verifyOwnPassword = async (password: string): Promise<void> => {
  await api.post<PasswordVerifyRequest, PasswordVerifyResponse>(
    apiEndpoints.passwordVerify,
    { password },
  );
};

export const lookupRegistrationToken = async (
  token: string,
): Promise<RegistrationTokenLookupResponse> => {
  return await api.get<RegistrationTokenLookupResponse>(
    apiEndpoints.registrationTokenLookup(token),
  );
};

export const listUserPasskeys = async (
  username: string,
): Promise<PasskeyCredentialList> => {
  return await api.get<PasskeyCredentialList>(
    apiEndpoints.userPasskeys(username),
  );
};

export const deleteUserPasskey = async (
  username: string,
  id: number,
): Promise<UserActionResult> => {
  return postWithStepUp<UserActionResult>(
    apiEndpoints.userPasskeyDelete(username, id),
  );
};

export const renameUserPasskey = async (
  username: string,
  id: number,
  deviceLabel: string,
): Promise<UserActionResult> => {
  return await api.post<{ deviceLabel: string }, UserActionResult>(
    apiEndpoints.userPasskeyRename(username, id),
    { deviceLabel },
  );
};

/**
 * Run the step-up dance: ask the server for an assertion challenge scoped to
 * the *current* user's credentials, drive the WebAuthn prompt, and return the
 * resulting step-up body (or an empty body when step-up isn't required).
 *
 * Used to wrap sensitive admin actions so a hijacked session cookie can't
 * silently mint credentials or wipe passkeys.
 */
export const performStepUp = async (): Promise<StepUpAssertionBody> => {
  const { needsStepUp, options } = await api.post<{}, StepUpOptionsResponse>(
    apiEndpoints.passkeyStepUpOptions,
    {},
  );
  if (!needsStepUp) return {};
  if (!options) {
    const password = await stepUpPasswordPrompt?.();
    if (!password) {
      throw new Error("Password required to continue");
    }
    return { stepUpPassword: password };
  }
  const stepUpAssertion = await runPasskeyCeremony(
    () =>
      startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      }),
    "Passkey verification was canceled or timed out.",
  );
  return { stepUpAssertion };
};

/**
 * POST a step-up-gated endpoint: run the step-up dance, then send the
 * step-up proof in the body. Used for the sensitive endpoints that can't be
 * reached on a hijacked cookie alone.
 */
export const postWithStepUp = async <R>(endpoint: string): Promise<R> => {
  return api.post<StepUpAssertionBody, R>(endpoint, await performStepUp());
};

export const issueRegistrationLink = async (
  username: string,
): Promise<RegistrationTokenResponse> => {
  return postWithStepUp<RegistrationTokenResponse>(
    apiEndpoints.userRegistrationToken(username),
  );
};

export const resetUserPasskeys = async (
  username: string,
): Promise<RegistrationTokenResponse> => {
  return postWithStepUp<RegistrationTokenResponse>(
    apiEndpoints.userResetPasskeys(username),
  );
};

function defaultDeviceLabel(_username: string): string {
  // Use the user-agent as a rough guess so the credential list is
  // distinguishable when a user enrolls multiple devices. Users can rename
  // labels later.
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

async function runPasskeyCeremony<T>(
  ceremony: () => Promise<T>,
  canceledMessage: string,
): Promise<T> {
  try {
    return await ceremony();
  } catch (error) {
    throw normalizePasskeyError(error, canceledMessage);
  }
}

function normalizePasskeyError(error: unknown, canceledMessage: string): Error {
  if (isPasskeyCancelOrTimeout(error)) {
    return new Error(canceledMessage);
  }
  if (error instanceof Error) return error;
  return new Error("Passkey operation failed.");
}

function isPasskeyCancelOrTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    cause?: unknown;
    message?: unknown;
  };
  const cause =
    candidate.cause && typeof candidate.cause === "object"
      ? (candidate.cause as { name?: unknown })
      : null;

  return (
    candidate.name === "NotAllowedError" ||
    cause?.name === "NotAllowedError" ||
    candidate.code === "ERROR_CEREMONY_ABORTED" ||
    candidate.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"
  );
}
