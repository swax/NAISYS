import {
  type ActionDef as ActionDefBase,
  type HateoasAction,
  type HateoasActionTemplate,
  permGate,
  resolveActions as resolveActionsBase,
  resolveActionTemplates as resolveActionTemplatesBase,
} from "@naisys/common";
import type { Permission } from "@naisys/supervisor-database";

import type { SupervisorUser } from "./authMiddleware.js";
import { hasPermission } from "./authMiddleware.js";

export { permGate };

export interface ActionDef<T> extends Omit<ActionDefBase<T>, "permission"> {
  permission?: Permission;
}

export function resolveActions<T extends { user: SupervisorUser | undefined }>(
  defs: ActionDef<T>[],
  baseHref: string,
  ctx: T,
): HateoasAction[] {
  return resolveActionsBase(defs, baseHref, ctx, (perm) =>
    hasPermission(ctx.user, perm as Permission),
  );
}

export function resolveActionTemplates<
  T extends { user: SupervisorUser | undefined },
>(defs: ActionDef<T>[], baseHref: string, ctx: T): HateoasActionTemplate[] {
  return resolveActionTemplatesBase(defs, baseHref, ctx, (perm) =>
    hasPermission(ctx.user, perm as Permission),
  );
}
