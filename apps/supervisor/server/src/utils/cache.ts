/**
 * Wraps an async function with time-based caching.
 * Multiple calls with the same arguments within the TTL window return the cached result.
 */
export function cachedForSeconds<TArgs extends unknown[], TResult>(
  seconds: number,
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  const cache = new Map<string, { result: TResult; expiresAt: number }>();

  return async (...args: TArgs) => {
    const now = Date.now();
    const key = JSON.stringify(args);
    const cached = cache.get(key);

    if (cached && now < cached.expiresAt) {
      return cached.result;
    }

    const result = await fn(...args);
    cache.set(key, { result, expiresAt: now + seconds * 1000 });
    return result;
  };
}
