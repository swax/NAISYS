import type { HateoasAction } from "./hateoas-types.js";

export function hasAction(
  actions: HateoasAction[] | undefined,
  rel: string,
): HateoasAction | undefined {
  return actions?.find((a) => a.rel === rel);
}
