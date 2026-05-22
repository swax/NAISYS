import { useCallback, useEffect, useRef } from "react";

/**
 * Tracks which message gaps a live socket stream has already tried to recover,
 * so a single dropped push doesn't trigger a refetch on every push that
 * follows it. The set is cleared whenever `queryKey` changes — a new
 * conversation, agent, or session.
 *
 * Returns `markGapRecovered(gapKey)`: `true` the first time a gap is seen (and
 * records it), `false` once it has already been handled.
 */
export function useGapRecovery(
  queryKey: readonly unknown[],
): (gapKey: string) => boolean {
  const recoveredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    recoveredRef.current = new Set();
  }, [queryKey]);

  return useCallback((gapKey: string): boolean => {
    if (recoveredRef.current.has(gapKey)) return false;
    recoveredRef.current.add(gapKey);
    return true;
  }, []);
}
