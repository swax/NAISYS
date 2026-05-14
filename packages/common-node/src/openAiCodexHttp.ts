// Shared low-level parsing helpers for OpenAI Codex OAuth HTTP responses.
// Used by both the supervisor device-auth flow and the usage check.

export function trimNonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Parse a value expressed in seconds into positive milliseconds, or undefined. */
export function normalizePositiveMilliseconds(
  value: unknown,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value * 1000);
  }
  const text = trimNonEmpty(value);
  if (!text || !/^\d+$/.test(text)) {
    return undefined;
  }
  const seconds = Number.parseInt(text, 10);
  return seconds > 0 ? seconds * 1000 : undefined;
}

/** Parse a finite number from a number or numeric string, or undefined. */
export function normalizeFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const text = trimNonEmpty(value);
  if (!text) {
    return undefined;
  }
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Build a readable error message from an OpenAI error response body. */
export function formatOpenAiError(params: {
  prefix: string;
  status: number;
  bodyText: string;
}): string {
  const body = parseJsonObject(params.bodyText);
  const error = trimNonEmpty(body?.error);
  const description = trimNonEmpty(body?.error_description);
  if (error && description) {
    return `${params.prefix}: ${error} (${description})`;
  }
  if (error) {
    return `${params.prefix}: ${error}`;
  }
  const bodyText = params.bodyText.replace(/\s+/g, " ").trim();
  return bodyText
    ? `${params.prefix}: HTTP ${params.status} ${bodyText}`
    : `${params.prefix}: HTTP ${params.status}`;
}
