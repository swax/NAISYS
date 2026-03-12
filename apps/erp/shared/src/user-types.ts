import { z } from "zod/v4";

export const ErpPermissionEnum = z.enum([
  "erp_admin",
  "manage_orders",
  "manage_runs",
  "view_all",
]);
export type ErpPermission = z.infer<typeof ErpPermissionEnum>;
export const ErpPermission = ErpPermissionEnum.enum;

const urlSafeUsername = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Must contain only letters, numbers, hyphens, and underscores",
  );

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
    permission: ErpPermissionEnum,
  })
  .strict();

export type GrantPermission = z.infer<typeof GrantPermissionSchema>;

export const ChangePasswordSchema = z
  .object({
    password: z.string().min(6),
  })
  .strict();

export type ChangePassword = z.infer<typeof ChangePasswordSchema>;

export const UserPermissionSchema = z.object({
  permission: ErpPermissionEnum,
  grantedAt: z.string(),
  grantedBy: z.number().nullable(),
  _actions: z.array(z.any()).optional(),
});

export const UserSchema = z.object({
  id: z.number(),
  username: z.string(),
  isAgent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  apiKey: z.string().nullable().optional(),
  permissions: z.array(UserPermissionSchema),
  _links: z.array(z.any()).optional(),
  _actions: z.array(z.any()).optional(),
});

export type User = z.infer<typeof UserSchema>;

export const UserListItemSchema = z.object({
  id: z.number(),
  username: z.string(),
  isAgent: z.boolean(),
  createdAt: z.string(),
  permissionCount: z.number(),
  _links: z.array(z.any()).optional(),
});

export type UserListItem = z.infer<typeof UserListItemSchema>;

export const UserListResponseSchema = z.object({
  items: z.array(UserListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  _links: z.array(z.any()).optional(),
  _actions: z.array(z.any()).optional(),
});

export type UserListResponse = z.infer<typeof UserListResponseSchema>;

export const UserListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});
