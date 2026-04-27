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
  RegistrationTokenLookupResponse,
  RegistrationTokenResponse,
  StepUpAssertionBody,
  StepUpOptionsResponse,
  UserActionResult,
} from "@naisys/supervisor-shared";
import {
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import { api, apiEndpoints } from "./apiClient";

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
  const response = await startAuthentication({
    optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
  });
  const user = await api.post<PasskeyAuthenticationVerify, AuthUser>(
    apiEndpoints.passkeyLoginVerify,
    { response },
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
  const stepUpAssertion = input.token ? null : await performStepUp();

  const { options, username } = await api.post<
    PasskeyRegistrationOptionsRequest,
    PasskeyRegistrationOptionsResponse
  >(apiEndpoints.passkeyRegisterOptions, {
    token: input.token,
    stepUpAssertion: stepUpAssertion ?? undefined,
  });

  const response = await startRegistration({
    optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
  });

  return await api.post<
    PasskeyRegistrationVerify,
    PasskeyRegistrationVerifyResponse
  >(apiEndpoints.passkeyRegisterVerify, {
    token: input.token,
    response,
    deviceLabel: input.deviceLabel ?? defaultDeviceLabel(username),
  });
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

/**
 * Run the step-up dance: ask the server for an assertion challenge scoped to
 * the *current* user's credentials, drive the WebAuthn prompt, and return the
 * resulting assertion (or null if the server says step-up isn't required).
 *
 * Used to wrap sensitive admin actions so a hijacked session cookie can't
 * silently mint credentials or wipe passkeys.
 */
export const performStepUp =
  async (): Promise<AuthenticationResponseJSON | null> => {
    const { needsStepUp, options } = await api.post<{}, StepUpOptionsResponse>(
      apiEndpoints.passkeyStepUpOptions,
      {},
    );
    if (!needsStepUp) return null;
    return await startAuthentication({
      optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
    });
  };

/**
 * POST a step-up-gated endpoint: run the step-up dance, then send the
 * assertion in the body. Used for the four sensitive endpoints that can't
 * be reached on a hijacked cookie alone.
 */
export const postWithStepUp = async <R>(endpoint: string): Promise<R> => {
  const stepUpAssertion = await performStepUp();
  return api.post<StepUpAssertionBody, R>(endpoint, {
    stepUpAssertion: stepUpAssertion ?? undefined,
  });
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
