/**
 * Resolve a dotted path like "contact.email" against an object.
 */
export function valueFromString(
  obj: unknown,
  path: string,
  defaultValue?: string,
): string | undefined {
  if (!path) {
    return obj as string | undefined;
  }
  const keys = path.split(".");
  let result: unknown = obj;
  for (const key of keys) {
    result = (result as Record<string, unknown>)?.[key];
    if (result === undefined) {
      return defaultValue;
    }
  }
  return result as string | undefined;
}

export type TemplateSegment =
  | { type: "text"; text: string }
  | { type: "variable"; variable: string; value: string | undefined };

const TEMPLATE_VAR_PATTERN = /\$\{([^}]+)}/g;

/**
 * Extract all unique keys referenced under a given namespace in one or more
 * template strings. E.g. `extractTemplateKeys(["...${env.FOO}..."], "env")` → `["FOO"]`
 */
export function extractTemplateKeys(
  templates: string[],
  namespace: string,
): string[] {
  const pattern = new RegExp(`\\$\\{${namespace}\\.([^}]+)\\}`, "g");
  const keys = new Set<string>();
  for (const t of templates) {
    for (const m of t.matchAll(pattern)) {
      keys.add(m[1]);
    }
  }
  return [...keys];
}

/**
 * Parse a template string into segments of plain text and template variables.
 * Variables are resolved against the provided maps keyed by namespace
 * (e.g. { agent: configObj, env: envMap }).
 */
export function parseTemplateSegments(
  template: string,
  varMaps: Record<string, Record<string, unknown>>,
): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let lastIndex = 0;

  for (const match of template.matchAll(TEMPLATE_VAR_PATTERN)) {
    const fullMatch = match[0]; // e.g. "${agent.username}"
    const inner = match[1]; // e.g. "agent.username"
    const matchStart = match.index;

    // Push preceding text
    if (matchStart > lastIndex) {
      segments.push({ type: "text", text: template.slice(lastIndex, matchStart) });
    }

    // Resolve the variable
    const dotIndex = inner.indexOf(".");
    let value: string | undefined;

    if (dotIndex !== -1) {
      const namespace = inner.slice(0, dotIndex);
      const key = inner.slice(dotIndex + 1);
      const map = varMaps[namespace];
      if (map) {
        value = valueFromString(map, key);
        if (value !== undefined) {
          value = String(value);
        }
      }
    }

    segments.push({ type: "variable", variable: fullMatch, value });
    lastIndex = matchStart + fullMatch.length;
  }

  // Trailing text
  if (lastIndex < template.length) {
    segments.push({ type: "text", text: template.slice(lastIndex) });
  }

  return segments;
}

/**
 * Resolve all template variables in a string, throwing on missing values.
 */
export function resolveTemplateString(
  template: string,
  varMaps: Record<string, Record<string, unknown>>,
): string {
  return template.replace(TEMPLATE_VAR_PATTERN, (fullMatch, inner: string) => {
    const dotIndex = inner.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(`Invalid template variable: ${fullMatch}`);
    }
    const namespace = inner.slice(0, dotIndex);
    const key = inner.slice(dotIndex + 1);
    const map = varMaps[namespace];
    if (!map) {
      throw new Error(
        `Agent config: Error, unknown namespace '${namespace}' in ${fullMatch}`,
      );
    }
    const value = valueFromString(map, key);
    if (value === undefined) {
      throw new Error(`Agent config: Error, ${key} is not defined`);
    }
    return String(value);
  });
}
