import { z } from "zod";

export const PermissionEnum = z.enum([
  "supervisor_admin",
  "manage_agents",
  "agent_communication",
  "manage_models",
  "manage_variables",
]);
export type Permission = z.infer<typeof PermissionEnum>;

export const CreateUserSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(6),
    isAgent: z.boolean().optional(),
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

export const ChangePasswordSchema = z
  .object({
    password: z.string().min(6),
  })
  .strict();

export type ChangePassword = z.infer<typeof ChangePasswordSchema>;

export const CreateAgentUserSchema = z
  .object({
    agentId: z.number().int(),
  })
  .strict();

export type CreateAgentUser = z.infer<typeof CreateAgentUserSchema>;
