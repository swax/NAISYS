/** Compact token count for tight UI surfaces (e.g. "12.3k", "1.5M", "123"). */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${Math.round(tokens)}`;
}

/** Full token count for tooltips and aggregate views (e.g. "12,345 tokens"). */
export function formatTokensLong(tokens: number): string {
  return `${Math.round(tokens).toLocaleString()} tokens`;
}
