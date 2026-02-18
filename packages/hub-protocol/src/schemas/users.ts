import { z } from "zod";

/** Response to user_list request - returns all users registered on the hub */
export const UserListResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  users: z
    .array(
      z.object({
        userId: z.number(),
        username: z.string(),
        leadUserId: z.number().optional(),
        configYaml: z.string(),
        assignedHostIds: z.array(z.number()).optional(),
        apiKey: z.string().optional(),
      }),
    )
    .optional(),
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
