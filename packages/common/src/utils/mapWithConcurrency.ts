/** Like `Promise.all(items.map(fn))` but caps in-flight work at `limit`.
 *  Output order matches input order. A rejection rejects the whole call
 *  (matches Promise.all); in-flight work isn't cancelled and may settle in
 *  the background — fine for idempotent I/O. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit <= 0) throw new Error("mapWithConcurrency: limit must be > 0");
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
