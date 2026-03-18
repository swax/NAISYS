import type {
  HateoasAction,
  HateoasActionTemplate,
} from "./hateoas-types.js";

export function hasAction(
  actions: HateoasAction[] | undefined,
  rel: string,
): HateoasAction | undefined {
  return actions?.find((a) => a.rel === rel);
}

export function hasActionTemplate(
  templates: HateoasActionTemplate[] | undefined,
  rel: string,
): HateoasActionTemplate | undefined {
  return templates?.find((t) => t.rel === rel);
}
