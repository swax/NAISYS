import type { z } from "zod/v4";

export function zodResolver(schema: z.ZodType) {
  return (values: Record<string, unknown>) => {
    const result = schema.safeParse(values);
    if (result.success) return {};
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      // Skip root-level errors (e.g. unrecognized keys from .strict() schemas)
      // so that extra form fields don't block submission
      if (!path) continue;
      if (!errors[path]) errors[path] = issue.message;
    }
    return errors;
  };
}
