/** One clock value per request keeps dispatch membership and actions consistent. */
export function retryWaitReason(
  retryNotBefore: Date | null | undefined,
  now = new Date(),
): string | null {
  return retryNotBefore && retryNotBefore > now
    ? `External blocker: retry is deferred until ${retryNotBefore.toISOString()}`
    : null;
}

export function eligibleRetryWhere(now = new Date()) {
  return { OR: [{ retryNotBefore: null }, { retryNotBefore: { lte: now } }] };
}
