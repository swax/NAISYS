import {
  HateoasActionSchema,
  HateoasActionTemplateSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
} from "@naisys/common";
import { z } from "zod";

export const StartupAttachmentSchema = z.object({
  attachmentId: z.number(),
  publicId: z.string(),
  filename: z.string(),
  fileSize: z.number(),
  path: z.string(),
  createdAt: z.string(),
  downloadUrl: z.string(),
  _actions: z.array(HateoasActionSchema).optional(),
});

export const StartupAttachmentListResponseSchema = z.object({
  items: z.array(StartupAttachmentSchema),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
  _actionTemplates: z.array(HateoasActionTemplateSchema).optional(),
});

export const StartupAttachmentResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  item: StartupAttachmentSchema.optional(),
});

export const UpdateStartupAttachmentRequestSchema = z
  .object({
    newPath: z.string().min(1),
  })
  .strict();

export type StartupAttachment = z.infer<typeof StartupAttachmentSchema>;
export type StartupAttachmentListResponse = z.infer<
  typeof StartupAttachmentListResponseSchema
>;
export type StartupAttachmentResponse = z.infer<
  typeof StartupAttachmentResponseSchema
>;
export type UpdateStartupAttachmentRequest = z.infer<
  typeof UpdateStartupAttachmentRequestSchema
>;
