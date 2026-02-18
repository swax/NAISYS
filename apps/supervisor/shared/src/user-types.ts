import { z } from "zod";

export const PermissionEnum = z.enum([
  "supervisor_admin",
  "manage_agents",
  "agent_communication",
  "manage_models",
  "manage_variables",
]);
export type Permission = z.infer<typeof PermissionEnum>;

export const AuthTypeEnum = z.enum(["password", "api_key"]);
export type AuthType = z.infer<typeof AuthTypeEnum>;

export const CreateUserSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(6),
    authType: AuthTypeEnum.optional(),
  })
  .strict();

export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    username: z.string().min(1).max(64).optional(),
    password: z.string().min(6).optional(),
  })
  .strict();

export type UpdateUser = z.infer<typeof UpdateUserSchema>;

export const GrantPermissionSchema = z
  .object({
    permission: PermissionEnum,
  })
  .strict();

export type GrantPermission = z.infer<typeof GrantPermissionSchema>;
