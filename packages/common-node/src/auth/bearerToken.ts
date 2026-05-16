/**
 * Extract the API key from an Authorization: Bearer header value.
 * Returns undefined if the header is missing or not in Bearer format.
 */
export function extractBearerToken(
  authHeader: string | undefined,
): string | undefined {
  if (!authHeader?.startsWith("Bearer ")) return undefined;
  return authHeader.slice(7);
}
