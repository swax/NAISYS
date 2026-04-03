import { URL_SAFE_KEY_MESSAGE, URL_SAFE_KEY_REGEX } from "@naisys/common";
import { z } from "zod";

export const PermissionEnum = z.enum([
  "supervisor_admin",
  "manage_agents",
  "manage_hosts",
  "agent_communication",
  "manage_models",
  "manage_variables",
  "view_run_logs",
]);
export type Permission = z.infer<typeof PermissionEnum>;

const urlSafeUsername = z
  .string()
  .min(1)
  .max(64)
  .regex(URL_SAFE_KEY_REGEX, URL_SAFE_KEY_MESSAGE);

export const CreateUserSchema = z
  .object({
    username: urlSafeUsername,
    password: z.string().min(6),
  })
  .strict();

export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    username: urlSafeUsername.optional(),
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
