export function sanitizeSpendLimit(num: any) {
  if (num === undefined) return undefined;
  const n = Number(num);
  if (isNaN(n) || n <= 0) {
    return undefined;
  }
  return n;
}
