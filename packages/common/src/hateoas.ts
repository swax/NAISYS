import type {
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
): HateoasActionTemplate | undefined {
  return templates?.find((t) => t.rel === rel);
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
  method: string;
  title: string;
  schema?: string;
  body?: Record<string, unknown>;
  permission?: string;
  statuses?: string[];
  visibleWhen?: (ctx: T) => boolean;
  hideWithoutPermission?: boolean;
  disabledWhen?: (ctx: T) => string | string[] | null;
}

export function resolveActions<T>(
  defs: ActionDef<T>[],
  baseHref: string,
  ctx: T,
  checkPermission: (permission: string) => boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];

  for (const def of defs) {
    if (def.statuses) {
      const status = (ctx as T & { status?: string }).status;
      if (!status || !def.statuses.includes(status)) continue;
    }
    if (def.visibleWhen && !def.visibleWhen(ctx)) continue;

    const hasPerm = !def.permission || checkPermission(def.permission);
    if (def.hideWithoutPermission && !hasPerm) continue;

    const gate =
      !hasPerm && def.permission
        ? {
            disabled: true as const,
            disabledReason: `Requires ${def.permission} permission`,
          }
        : {};

    const disabledReason =
      hasPerm && def.disabledWhen ? def.disabledWhen(ctx) : null;

    actions.push({
      rel: def.rel,
      href: def.href ?? baseHref + (def.path ?? ""),
      method: def.method,
      title: def.title,
      ...(def.schema ? { schema: def.schema } : {}),
      ...(def.body ? { body: def.body } : {}),
      ...gate,
      ...(disabledReason ? { disabled: true, disabledReason } : {}),
    });
  }

  return actions;
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
