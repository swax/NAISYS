interface ZodLikeSchema {
  safeParse(data: unknown): {
    success: boolean;
    error?: { issues: Array<{ path: PropertyKey[]; message: string }> };
  };
}

export function zodResolver(schema: ZodLikeSchema) {
  return (values: Record<string, unknown>) => {
    const result = schema.safeParse(values);
    if (result.success) return {};
    const errors: Record<string, string> = {};
    for (const issue of result.error!.issues) {
      const path = issue.path.map(String).join(".");
      if (!errors[path]) errors[path] = issue.message;
    }
    return errors;
  };
}
