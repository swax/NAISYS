import { z } from "zod/v4";

export const HateoasLinkSchema = z.object({
  rel: z.string(),
  href: z.string(),
  method: z.string().optional(),
  title: z.string().optional(),
  schema: z.string().optional(),
});

export type HateoasLink = z.infer<typeof HateoasLinkSchema>;

export const HateoasActionSchema = z.object({
  rel: z.string(),
  href: z.string(),
  method: z.string(),
  title: z.string().optional(),
  schema: z.string().optional(),
  body: z.record(z.string(), z.unknown()).optional(),
});

export type HateoasAction = z.infer<typeof HateoasActionSchema>;

export const HateoasLinksSchema = z.object({
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type HateoasLinks = z.infer<typeof HateoasLinksSchema>;
