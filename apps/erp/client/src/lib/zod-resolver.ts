import type { z } from "zod/v4";

export function zodResolver(schema: z.ZodType) {
  return (values: Record<string, unknown>) => {
    const result = schema.safeParse(values);
    if (result.success) return {};
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      if (!errors[path]) errors[path] = issue.message;
    }
    return errors;
  };
}
