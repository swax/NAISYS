/** Cached auth lookup result. `null` means the token was checked and found invalid. */
interface AuthCacheEntry<TUser> {
  user: TUser | null;
  expiresAt: number;
}

export interface AuthCacheOptions {
  /** TTL in ms for valid (authenticated) entries. Default: 60_000 */
  ttlMs?: number;
  /** TTL in ms for negative (unauthenticated) entries. Default: 10_000 */
  negativeTtlMs?: number;
  /** Maximum number of cached entries. Default: 1_000 */
  maxSize?: number;
}

export class AuthCache<TUser> {
  private cache = new Map<string, AuthCacheEntry<TUser>>();
  private ttlMs: number;
  private negativeTtlMs: number;
  private maxSize: number;

  constructor(options: AuthCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.negativeTtlMs = options.negativeTtlMs ?? 10_000;
    this.maxSize = options.maxSize ?? 1_000;
  }

  /** Returns the cached user, `null` for a negative hit, or `undefined` on cache miss. */
  get(key: string): TUser | null | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.user;
  }

  /** Cache a lookup result. Pass `null` to cache a negative (invalid token) result. */
  set(key: string, user: TUser | null) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value!;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      user,
      expiresAt: Date.now() + (user ? this.ttlMs : this.negativeTtlMs),
    });
  }

  /** Remove a specific key from the cache (e.g. on logout). */
  invalidate(key: string) {
    this.cache.delete(key);
  }

  /** Clear the entire cache. */
  clear() {
    this.cache.clear();
  }
}
