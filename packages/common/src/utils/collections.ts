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

/** Merge two item sequences by key. Later items from `incoming` overwrite existing values. */
export function mergeByKey<T, K>(
  existing: Iterable<T>,
  incoming: Iterable<T>,
  keyFn: (item: T) => K,
): T[] {
  const map = keyBy(existing, keyFn);
  for (const item of incoming) map.set(keyFn(item), item);
  return Array.from(map.values());
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

/** Map items and drop only null/undefined results. */
export function mapDefined<T, R>(
  items: Iterable<T>,
  mapFn: (item: T) => R | null | undefined,
): R[] {
  const result: R[] = [];
  for (const item of items) {
    const mapped = mapFn(item);
    if (isDefined(mapped)) result.push(mapped);
  }
  return result;
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

type SortKey = string | number | bigint | boolean | Date | null | undefined;

function normalizeSortKey(value: SortKey): string | number | bigint | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function compareSortKeys(a: SortKey, b: SortKey): number {
  const left = normalizeSortKey(a);
  const right = normalizeSortKey(b);
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "string" || typeof right === "string") {
    return String(left).localeCompare(String(right));
  }
  return left < right ? -1 : 1;
}

function compareSortKeysDesc(a: SortKey, b: SortKey): number {
  const left = normalizeSortKey(a);
  const right = normalizeSortKey(b);
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareSortKeys(b, a);
}

function compareMaxKeys(a: SortKey, b: SortKey): number {
  const left = normalizeSortKey(a);
  const right = normalizeSortKey(b);
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareSortKeys(a, b);
}

function toKeyTuple(value: SortKey | readonly SortKey[]): readonly SortKey[] {
  return Array.isArray(value) ? value : [value as SortKey];
}

function compareTuplesWith(
  a: readonly SortKey[],
  b: readonly SortKey[],
  pairCompare: (x: SortKey, y: SortKey) => number,
): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const cmp = pairCompare(a[i], b[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/** Return a sorted copy of `items`, ascending by `keyFn`. Return an array
 *  of keys to sort by multiple keys with later keys breaking earlier ties. */
export function sortBy<T>(
  items: Iterable<T>,
  keyFn: (item: T) => SortKey | readonly SortKey[],
): T[] {
  return Array.from(items).sort((a, b) =>
    compareTuplesWith(
      toKeyTuple(keyFn(a)),
      toKeyTuple(keyFn(b)),
      compareSortKeys,
    ),
  );
}

/** Return a sorted copy of `items`, descending by `keyFn`. Return an array
 *  of keys to sort by multiple keys with later keys breaking earlier ties.
 *  Nullish keys sort last regardless of direction. */
export function sortByDesc<T>(
  items: Iterable<T>,
  keyFn: (item: T) => SortKey | readonly SortKey[],
): T[] {
  return Array.from(items).sort((a, b) =>
    compareTuplesWith(
      toKeyTuple(keyFn(a)),
      toKeyTuple(keyFn(b)),
      compareSortKeysDesc,
    ),
  );
}

/** Return the item with the smallest projected key, or undefined for empty input. */
export function minBy<T>(
  items: Iterable<T>,
  keyFn: (item: T) => SortKey,
): T | undefined {
  let best: T | undefined;
  let bestKey: SortKey | undefined;
  let hasBest = false;
  for (const item of items) {
    const key = keyFn(item);
    if (!hasBest || compareSortKeys(key, bestKey) < 0) {
      best = item;
      bestKey = key;
      hasBest = true;
    }
  }
  return best;
}

/** Return the item with the largest projected key, or undefined for empty input. */
export function maxBy<T>(
  items: Iterable<T>,
  keyFn: (item: T) => SortKey,
): T | undefined {
  let best: T | undefined;
  let bestKey: SortKey | undefined;
  let hasBest = false;
  for (const item of items) {
    const key = keyFn(item);
    if (!hasBest || compareMaxKeys(key, bestKey) > 0) {
      best = item;
      bestKey = key;
      hasBest = true;
    }
  }
  return best;
}

export function toRecord<K extends PropertyKey, V>(
  entries: Iterable<readonly [K, V]>,
): Record<K, V>;
export function toRecord<T, K extends PropertyKey, V>(
  items: Iterable<T>,
  keyFn: (item: T) => K,
  valueFn: (item: T) => V,
): Record<K, V>;
/** Build a plain object record from map entries or projected items. */
export function toRecord<T, K extends PropertyKey, V>(
  source: Iterable<T> | Iterable<readonly [K, V]>,
  keyFn?: (item: T) => K,
  valueFn?: (item: T) => V,
): Record<K, V> {
  const record = {} as Record<K, V>;
  if (keyFn && valueFn) {
    for (const item of source as Iterable<T>) {
      record[keyFn(item)] = valueFn(item);
    }
  } else {
    for (const [key, value] of source as Iterable<readonly [K, V]>) {
      record[key] = value;
    }
  }
  return record;
}
