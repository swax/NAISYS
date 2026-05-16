// OpenAI rotates the refresh token on each /oauth/token POST, so only one
// writer can safely hold it — this module single-flights the refresh path.

const OPENAI_AUTH_BASE_URL = "https://auth.openai.com";
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REFRESH_SKEW_MS = 5 * 60_000;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type CodexToken = {
  access: string;
  refresh: string;
  expires: number;
};

export interface CodexAccessTokenResult {
  accessToken: string;
  /** Unix epoch milliseconds when the access token expires (from JWT `exp` or `expires_in`). */
  expiresAt: number;
}

function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeLifetimeMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value * 1000);
  }
  const text = trimNonEmpty(value);
  if (!text || !/^\d+$/.test(text)) {
    return undefined;
  }
  return Number.parseInt(text, 10) * 1000;
}

export function resolveCodexAccessTokenExpiry(
  token: string,
): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) {
    return undefined;
  }

  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof body.exp === "number" && Number.isFinite(body.exp)
      ? Math.trunc(body.exp * 1000)
      : undefined;
  } catch {
    return undefined;
  }
}

function formatRefreshError(status: number, bodyText: string): string {
  const body = parseJsonObject(bodyText);
  const error = trimNonEmpty(body?.error);
  const description = trimNonEmpty(body?.error_description);
  if (error && description) {
    return `OpenAI OAuth refresh failed: ${error} (${description})`;
  }
  if (error) {
    return `OpenAI OAuth refresh failed: ${error}`;
  }
  const bodySummary = bodyText.replace(/\s+/g, " ").trim();
  return bodySummary
    ? `OpenAI OAuth refresh failed: HTTP ${status} ${bodySummary}`
    : `OpenAI OAuth refresh failed: HTTP ${status}`;
}

export async function refreshCodexToken(
  refreshToken: string,
  fetchFn: FetchLike = fetch,
): Promise<CodexToken> {
  const response = await fetchFn(`${OPENAI_AUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(formatRefreshError(response.status, bodyText));
  }

  const body = parseJsonObject(bodyText);
  const access = trimNonEmpty(body?.access_token);
  const refresh = trimNonEmpty(body?.refresh_token) ?? refreshToken;
  if (!access) {
    throw new Error(
      "OpenAI OAuth refresh succeeded but did not return an access token.",
    );
  }

  const expiresInMs = normalizeLifetimeMs(body?.expires_in);
  return {
    access,
    refresh,
    expires:
      expiresInMs !== undefined
        ? Date.now() + expiresInMs
        : (resolveCodexAccessTokenExpiry(access) ?? Date.now()),
  };
}

/** Becomes `stale: true` mid-flight if reset() is called while resolveFresh is awaiting. Resolvers with persistence side effects should check before committing. */
export interface CodexResolveFreshSignal {
  readonly stale: boolean;
}

export interface CodexAccessTokenCacheOptions {
  /** Fetches a fresh access token + expiry. The cache calls this when no cached entry is valid. */
  resolveFresh: (
    signal: CodexResolveFreshSignal,
  ) => Promise<CodexAccessTokenResult | undefined>;
  /** How early to treat a cached token as stale (defaults to 5 min). */
  skewMs?: number;
  /** Cache resolveFresh failures for this many ms — subsequent calls within the window throw the cached error without retrying. Zero (default) disables. */
  failureCooldownMs?: number;
  /** Override now() for tests. */
  now?: () => number;
}

export interface CodexAccessTokenProvider {
  getAccessToken(): Promise<CodexAccessTokenResult | undefined>;
  /** Drops the access-token cache + failure cooldown. Use for force-refresh after an observed auth failure — keeps any in-memory rotated refresh token. */
  invalidate(): void;
  /** Harder reset that also drops the in-memory rotated refresh token. Use after external re-auth replaces the persisted refresh value. */
  reset(): void;
}

/** Single-flight expiring cache. Use when the caller produces tokens directly (e.g. agent fetching from the hub). */
export function createCodexAccessTokenCache(
  options: CodexAccessTokenCacheOptions,
): CodexAccessTokenProvider {
  const skewMs = options.skewMs ?? REFRESH_SKEW_MS;
  const failureCooldownMs = options.failureCooldownMs ?? 0;
  const now = options.now ?? Date.now;

  // Bumped only by reset(). An in-flight refresh snapshots this and discards
  // its commit if a reset arrived during the await — protects against an
  // old-account refresh repopulating cache state after re-auth.
  let resetGeneration = 0;
  let cached: CodexAccessTokenResult | undefined;
  let cachedFailure: { error: Error; until: number } | undefined;
  let inFlight: Promise<CodexAccessTokenResult | undefined> | undefined;

  async function refresh(): Promise<CodexAccessTokenResult | undefined> {
    const myGen = resetGeneration;
    const signal: CodexResolveFreshSignal = {
      get stale() {
        return myGen !== resetGeneration;
      },
    };
    try {
      const fresh = await options.resolveFresh(signal);
      if (signal.stale) return undefined;
      cached = fresh;
      cachedFailure = undefined;
      return fresh;
    } catch (err) {
      if (!signal.stale && failureCooldownMs > 0) {
        const error = err instanceof Error ? err : new Error(String(err));
        cachedFailure = { error, until: now() + failureCooldownMs };
      }
      throw err;
    }
  }

  async function getAccessToken(): Promise<CodexAccessTokenResult | undefined> {
    if (cached && cached.expiresAt > now() + skewMs) {
      return cached;
    }
    if (cachedFailure && cachedFailure.until > now()) {
      throw cachedFailure.error;
    }
    if (!inFlight) {
      // Identity-checked finally so a reset() that nulls inFlight mid-flight
      // doesn't get clobbered by the prior promise's settle.
      const myPromise = refresh().finally(() => {
        if (inFlight === myPromise) inFlight = undefined;
      });
      inFlight = myPromise;
    }
    return inFlight;
  }

  function invalidate(): void {
    cached = undefined;
    cachedFailure = undefined;
    // Keep inFlight + resetGeneration — invalidate is for force-refresh on
    // the same account, so an in-flight result is still relevant.
  }

  function reset(): void {
    resetGeneration++;
    cached = undefined;
    cachedFailure = undefined;
    // Drop inFlight so the next caller starts a fresh refresh against
    // post-reset state instead of waiting on a promise that will discard.
    inFlight = undefined;
  }

  return { getAccessToken, invalidate, reset };
}

export interface CodexAccessTokenProviderOptions {
  /** Reads the latest persisted refresh token (or undefined if not configured). */
  getRefreshToken: () => Promise<string | undefined> | string | undefined;
  /**
   * Persists the rotated refresh token via compare-and-swap. `priorToken` is
   * the value the provider believes is currently persisted (the value it used
   * to obtain `refreshToken`). Return `false` if the persisted row no longer
   * holds `priorToken` (e.g. an external writer replaced it during re-auth);
   * the provider will discard its rotation rather than overwrite the new
   * value. Return `true` on a successful save. Callers in single-writer
   * environments (no concurrent external writers) can always return `true`.
   */
  saveRefreshToken: (
    refreshToken: string,
    priorToken: string | undefined,
  ) => Promise<boolean>;
  /** Override fetch for tests. */
  fetchFn?: FetchLike;
  /** Cache OAuth refresh failures for this many ms (see cache option). */
  failureCooldownMs?: number;
  /** Override now() for tests. */
  now?: () => number;
}

/**
 * Refresh-token-backed provider. Only the refresh token is persisted; access
 * tokens live in memory.
 *
 * Four layered protections against re-auth / save races, each covering a
 * window the others can't:
 *   1. `reset()` + `signal.stale` — explicit VARIABLES_CHANGED signal: the
 *      caller tells us the persisted refresh token was replaced. An in-flight
 *      rotation discards its result rather than persisting it.
 *   2. Divergence-on-read — at the start of a rotation, compare the fresh
 *      `getRefreshToken()` value to `expectedPersistedRefresh`. If they
 *      differ (replaced, or removed), any in-memory rotation we hold is on a
 *      dead lineage. A removal additionally aborts the rotation so we don't
 *      recreate the row the operator just cleared.
 *   3. CAS-on-write — `saveRefreshToken` receives the prior value as a
 *      compare-and-swap key. If the row no longer holds that value (or no
 *      prior value existed), the save aborts and we discard our rotation.
 *      Closes the read→write race window.
 *   4. `inMemoryRefresh` — bridges transient persistence failures. OpenAI
 *      invalidates the prior refresh token on every rotation, so if save
 *      throws (DB down) the next attempt must use the new value we hold, not
 *      the stale persisted one OpenAI has already burned.
 */
export function createCodexAccessTokenProvider(
  options: CodexAccessTokenProviderOptions,
): CodexAccessTokenProvider {
  const fetchFn = options.fetchFn ?? fetch;
  // Most-recent rotation from OpenAI, used to bridge transient save failures.
  let inMemoryRefresh: string | undefined;
  // What we last successfully wrote or read. A divergence from a fresh DB
  // read means an external writer replaced the value.
  let expectedPersistedRefresh: string | undefined;

  const cache = createCodexAccessTokenCache({
    now: options.now,
    failureCooldownMs: options.failureCooldownMs,
    resolveFresh: async (signal) => {
      const persisted = trimNonEmpty(await options.getRefreshToken());

      if (expectedPersistedRefresh && persisted !== expectedPersistedRefresh) {
        // External writer changed the persisted token — either replaced
        // it (re-auth) or removed it (operator cleared the variable).
        // Our in-memory rotation belongs to a dead lineage either way.
        inMemoryRefresh = undefined;
        expectedPersistedRefresh = undefined;
        if (!persisted) {
          // Removed: refusing here ensures we don't refresh against the
          // stale in-memory token and resurrect the row the operator
          // just cleared.
          return undefined;
        }
      }
      if (persisted && !expectedPersistedRefresh) {
        expectedPersistedRefresh = persisted;
      }

      const refreshToken = trimNonEmpty(inMemoryRefresh ?? persisted);
      if (!refreshToken) {
        return undefined;
      }

      const refreshed = await refreshCodexToken(refreshToken, fetchFn);
      if (signal.stale) {
        // reset() fired during the OAuth call — caller replaced the
        // persisted refresh token. Don't write inMemoryRefresh and don't
        // persist; the new account's state is authoritative.
        return undefined;
      }
      // Update the in-memory pointer BEFORE saving so a save failure doesn't
      // make the next attempt replay the stale token.
      inMemoryRefresh = refreshed.refresh;
      if (refreshed.refresh !== persisted) {
        // Save whenever DB drifts from the latest OAuth-issued token —
        // covers both rotation AND the case where a prior save failed and
        // this OAuth response didn't rotate (DB still holds the
        // pre-failure value).
        const saved = await options.saveRefreshToken(
          refreshed.refresh,
          persisted,
        );
        if (!saved) {
          // CAS failed (or save refused): the persisted row was replaced
          // externally between our read and our write, or never existed.
          // The token we just received from OpenAI is valid in isolation
          // but we don't know what account/state it belongs to relative
          // to the persisted value — safer to discard. Next call
          // re-reads the persisted state cleanly.
          inMemoryRefresh = undefined;
          expectedPersistedRefresh = undefined;
          return undefined;
        }
        expectedPersistedRefresh = refreshed.refresh;
      }
      return { accessToken: refreshed.access, expiresAt: refreshed.expires };
    },
  });

  return {
    getAccessToken: cache.getAccessToken,
    // Force-refresh path: keep the in-memory rotated token so a save failure
    // can't cause the next attempt to replay the stale persisted value.
    invalidate: cache.invalidate,
    // External re-auth path: bump generation (so an in-flight refresh
    // discards its commit) and drop the in-memory rotated token so the
    // freshly persisted value is read on the next attempt.
    reset: () => {
      inMemoryRefresh = undefined;
      expectedPersistedRefresh = undefined;
      cache.reset();
    },
  };
}
