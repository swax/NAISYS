/** Return the value at `key`, creating and storing it when missing. */
export function getOrInsert<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  if (map.has(key)) return map.get(key) as V;
  const value = factory();
  map.set(key, value);
  return value;
}

/** Append `value` to the array at `key`, creating the array if missing. */
export function pushToArrayMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  getOrInsert(map, key, () => []).push(value);
}

/** Add `value` to the set at `key`, creating the set if missing. */
export function addToSetMap<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  getOrInsert(map, key, () => new Set()).add(value);
}

/** Delete `value` from the set at `key`, removing the key when the set is empty. */
export function deleteFromSetMap<K, V>(
  map: Map<K, Set<V>>,
  key: K,
  value: V,
): boolean {
  const set = map.get(key);
  if (!set) return false;
  const deleted = set.delete(value);
  if (set.size === 0) map.delete(key);
  return deleted;
}

/** Clear `target` and refill from `source`. Useful when the Set reference
 *  must be preserved (e.g. captured by closures or exported as const). */
export function replaceSetContents<T>(
  target: Set<T>,
  source: Iterable<T>,
): void {
  const items = Array.from(source);
  target.clear();
  for (const item of items) target.add(item);
}

/** Membership equality for two sets — same size and every element in `a` is in `b`. */
export function setEquals<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/** Build a map from `items`, keyed by `keyFn`. Later items with the same key win. */
export function keyBy<T, K>(
  items: Iterable<T>,
  keyFn: (item: T) => K,
): Map<K, T> {
  const map = new Map<K, T>();
  for (const item of items) map.set(keyFn(item), item);
  return map;
}

/** Group items by `keyFn`, preserving input order within each group. */
export function groupBy<T, K>(
  items: Iterable<T>,
  keyFn: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) pushToArrayMap(map, keyFn(item), item);
  return map;
}

/** Return unique values while preserving first-seen order. */
export function unique<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

/** Return unique items by `keyFn` while preserving first-seen order. */
export function uniqueBy<T, K>(items: Iterable<T>, keyFn: (item: T) => K): T[] {
  const seen = new Set<K>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Type guard for null/undefined ONLY. Falsy values like 0, "", false PASS.
 *
 * NOT equivalent to `.filter(Boolean)`. If a value's type includes ""/0/false
 * and you want those dropped too, use `.filter(Boolean)` directly.
 *
 * @example
 *   ["a", null, "", undefined].filter(isDefined)  // ["a", ""]
 *   ["a", null, "", undefined].filter(Boolean)    // ["a"]
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/** Sum numeric values projected from `items`. */
export function sumBy<T>(
  items: Iterable<T>,
  valueFn: (item: T) => number,
): number {
  let total = 0;
  for (const item of items) total += valueFn(item);
  return total;
}

/** Count items by `keyFn`. */
export function countBy<T, K>(
  items: Iterable<T>,
  keyFn: (item: T) => K,
): Map<K, number> {
  const counts = new Map<K, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
