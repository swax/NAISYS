import {
  HateoasActionSchema,
  HateoasLinkSchema,
  HateoasLinkTemplateSchema,
  URL_SAFE_KEY_MESSAGE,
  URL_SAFE_KEY_REGEX,
} from "@naisys/common";
import { z } from "zod";

export const PermissionEnum = z.enum([
  "supervisor_admin",
  "manage_agents",
  "remote_execution",
  "manage_hosts",
  "agent_communication",
  "manage_models",
  "manage_variables",
  "view_run_logs",
]);
export type Permission = z.infer<typeof PermissionEnum>;

export const PermissionDescriptions: Record<Permission, string> = {
  supervisor_admin: "Full access, including user management",
  manage_agents:
    "Create, configure, start/stop, pause/resume, archive, and delete agents",
  remote_execution:
    "Send arbitrary commands to an agent's active run (remote shell access)",
  manage_hosts: "Register and manage agent hosts",
  agent_communication: "Send messages to agents via mail and chat",
  manage_models: "Add, edit, and remove LLM model configurations",
  manage_variables: "Manage global variables used by agents",
  view_run_logs: "View unobfuscated run logs",
};

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

// --- Response schemas ---

export const UserListItemSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  username: z.string(),
  isAgent: z.boolean(),
  createdAt: z.string(),
  permissionCount: z.number(),
});
export type UserListItem = z.infer<typeof UserListItemSchema>;

export const UserListResponseSchema = z.object({
  items: z.array(UserListItemSchema),
  total: z.number(),
  pageSize: z.number(),
  _links: z.array(HateoasLinkSchema),
  _linkTemplates: z.array(HateoasLinkTemplateSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const UserPermissionSchema = z.object({
  permission: PermissionEnum,
  grantedAt: z.string(),
  grantedBy: z.number().nullable(),
  _actions: z.array(HateoasActionSchema).optional(),
});
export type UserPermission = z.infer<typeof UserPermissionSchema>;

export const UserDetailResponseSchema = z.object({
  id: z.number(),
  username: z.string(),
  isAgent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  apiKey: z.string().nullable().optional(),
  hasApiKey: z.boolean(),
  permissions: z.array(UserPermissionSchema),
  _links: z.array(HateoasLinkSchema),
  _actions: z.array(HateoasActionSchema).optional(),
});
export type UserDetailResponse = z.infer<typeof UserDetailResponseSchema>;

export const UserActionResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type UserActionResult = z.infer<typeof UserActionResultSchema>;

export const CreateUserResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  id: z.number(),
  username: z.string(),
});
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;
