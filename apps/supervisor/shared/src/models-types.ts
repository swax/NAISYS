import { z } from "zod";

const ModelOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const ModelsResponseSchema = z.object({
  llmModels: z.array(ModelOptionSchema),
  imageModels: z.array(ModelOptionSchema),
});

export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;
