import { z } from "zod";

// Zod schemas
export const HelloResponseSchema = z.object({
  message: z.string(),
  timestamp: z.string(),
  success: z.boolean(),
});

// Inferred types
export type HelloResponse = z.infer<typeof HelloResponseSchema>;

export * from "./session-types.js";
export * from "./settings-types.js";
export * from "./agents-types.js";
export * from "./log-types.js";
export * from "./data-types.js";
export * from "./runs-types.js";
