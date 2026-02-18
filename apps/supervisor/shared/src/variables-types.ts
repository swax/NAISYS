import { HateoasActionSchema } from "@naisys/common";
import { z } from "zod";

export const VariableSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export type Variable = z.infer<typeof VariableSchema>;

export const VariablesResponseSchema = z.object({
  items: z.array(VariableSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});

export type VariablesResponse = z.infer<typeof VariablesResponseSchema>;

export const SaveVariableRequestSchema = z.object({
  value: z.string(),
});

export type SaveVariableRequest = z.infer<typeof SaveVariableRequestSchema>;

export const SaveVariableResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type SaveVariableResponse = z.infer<typeof SaveVariableResponseSchema>;

export const DeleteVariableParamsSchema = z.object({
  key: z.string(),
});

export type DeleteVariableParams = z.infer<typeof DeleteVariableParamsSchema>;

export const DeleteVariableResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type DeleteVariableResponse = z.infer<
  typeof DeleteVariableResponseSchema
>;
