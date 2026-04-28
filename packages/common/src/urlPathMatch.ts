/**
 * Strict prefix match for URL paths. Returns true only when `url` is exactly
 * `prefix`, a subpath under `prefix`, or `prefix` followed by a query string.
 * Avoids the `startsWith` pitfall where `/foo/login` would match `/foo/login_admin`.
 */
export function urlMatchesPrefix(url: string, prefix: string): boolean {
  return (
    url === prefix ||
    url.startsWith(prefix + "/") ||
    url.startsWith(prefix + "?")
  );
}
