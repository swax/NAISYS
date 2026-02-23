import { ImageModelSchema,LlmModelSchema } from "@naisys/common";
import { z } from "zod";

/** Pushed from hub to NAISYS instances with all model definitions */
export const ModelsResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  llmModels: z.array(LlmModelSchema).optional(),
  imageModels: z.array(ImageModelSchema).optional(),
});
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;
