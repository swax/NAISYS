import {
  type ActionDef as ActionDefBase,
  type HateoasAction,
  permGate,
  resolveActions as resolveActionsBase,
} from "@naisys/common";
import type { Permission } from "@naisys/supervisor-database";

import type { SupervisorUser } from "./auth-middleware.js";
import { hasPermission } from "./auth-middleware.js";

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
