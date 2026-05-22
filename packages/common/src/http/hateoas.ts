import type {
  AlternateEncoding,
  HateoasAction,
  HateoasActionTemplate,
  HateoasLinkTemplate,
} from "./hateoas-types.js";

/**
 * Returns the action if it exists and is enabled.
 * Pass `{ includeDisabled: true }` to also return disabled actions
 * (e.g. when rendering a disabled button with a tooltip).
 */
export function hasAction(
  actions: HateoasAction[] | undefined,
  rel: string,
  opts?: { includeDisabled: boolean },
): HateoasAction | undefined {
  const a = actions?.find((a) => a.rel === rel);
  if (!a) return undefined;
  if (a.disabled && !opts?.includeDisabled) return undefined;
  return a;
}

export function hasActionTemplate(
  templates: HateoasActionTemplate[] | undefined,
  rel: string,
  opts?: { includeDisabled: boolean },
): HateoasActionTemplate | undefined {
  const t = templates?.find((t) => t.rel === rel);
  if (!t) return undefined;
  if (t.disabled && !opts?.includeDisabled) return undefined;
  return t;
}

export function hasLinkTemplate(
  templates: HateoasLinkTemplate[] | undefined,
  rel: string,
): HateoasLinkTemplate | undefined {
  return templates?.find((t) => t.rel === rel);
}

// --- Declarative action resolver ---

export interface ActionDef<T> {
  rel: string;
  path?: string;
  href?: string;
  hrefTemplate?: string;
  method: string;
  title: string;
  schema?: string;
  body?: Record<string, unknown>;
  alternateEncoding?: AlternateEncoding;
  permission?: string;
  statuses?: string[];
  visibleWhen?: (ctx: T) => boolean;
  hideWithoutPermission?: boolean;
  disabledWhen?: (ctx: T) => string | string[] | null;
}

/** Fields common to a resolved action and a resolved action template. */
interface ResolvedActionCore {
  rel: string;
  method: string;
  title: string;
  schema?: string;
  body?: Record<string, unknown>;
  alternateEncoding?: AlternateEncoding;
  disabled?: true;
  disabledReason?: string | string[];
}

/**
 * Apply a def's status / visibility / permission guards. Returns the fields
 * shared by actions and templates, or `null` if the def is filtered out.
 */
function resolveActionCore<T>(
  def: ActionDef<T>,
  ctx: T,
  checkPermission: (permission: string) => boolean,
): ResolvedActionCore | null {
  if (def.statuses) {
    const status = (ctx as T & { status?: string }).status;
    if (!status || !def.statuses.includes(status)) return null;
  }
  if (def.visibleWhen && !def.visibleWhen(ctx)) return null;

  const hasPerm = !def.permission || checkPermission(def.permission);
  if (def.hideWithoutPermission && !hasPerm) return null;

  const gate =
    !hasPerm && def.permission
      ? {
          disabled: true as const,
          disabledReason: `Requires ${def.permission} permission`,
        }
      : {};

  const disabledReason =
    hasPerm && def.disabledWhen ? def.disabledWhen(ctx) : null;

  return {
    rel: def.rel,
    method: def.method,
    title: def.title,
    ...(def.schema ? { schema: def.schema } : {}),
    ...(def.body ? { body: def.body } : {}),
    ...(def.alternateEncoding
      ? { alternateEncoding: def.alternateEncoding }
      : {}),
    ...gate,
    ...(disabledReason ? { disabled: true as const, disabledReason } : {}),
  };
}

export function resolveActions<T>(
  defs: ActionDef<T>[],
  baseHref: string,
  ctx: T,
  checkPermission: (permission: string) => boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];
  for (const def of defs) {
    const core = resolveActionCore(def, ctx, checkPermission);
    if (!core) continue;
    actions.push({ ...core, href: def.href ?? baseHref + (def.path ?? "") });
  }
  return actions;
}

/**
 * Like {@link resolveActions}, but emits `HateoasActionTemplate`s — actions with
 * an `hrefTemplate` (carrying `{placeholders}`) instead of a resolved `href`.
 * Use for an operation the current response can't fully address yet, e.g. a
 * per-item action advertised on a collection so it stays discoverable when the
 * collection is empty.
 */
export function resolveActionTemplates<T>(
  defs: ActionDef<T>[],
  baseHref: string,
  ctx: T,
  checkPermission: (permission: string) => boolean,
): HateoasActionTemplate[] {
  const templates: HateoasActionTemplate[] = [];
  for (const def of defs) {
    const core = resolveActionCore(def, ctx, checkPermission);
    if (!core) continue;
    templates.push({
      ...core,
      hrefTemplate: def.hrefTemplate ?? baseHref + (def.path ?? ""),
    });
  }
  return templates;
}

export function permGate(hasPerm: boolean, permission: string) {
  return hasPerm
    ? {}
    : {
        disabled: true as const,
        disabledReason: `Requires ${permission} permission`,
      };
}

/** Normalize a `disabledReason` (string | string[] | undefined) to a single display string. */
export function formatDisabledReason(
  reason: string | string[] | undefined,
): string | undefined {
  if (!reason) return undefined;
  return Array.isArray(reason) ? reason.join("\n") : reason;
}
