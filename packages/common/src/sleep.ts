/** Async sleep utility. Usage: `await sleep(1000)` */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
