import { z } from "zod/v4";
import type { $ZodType } from "zod/v4/core";
import {
  CreateUserSchema,
  UpdateUserSchema,
  GrantPermissionSchema,
  LoginRequestSchema,
} from "@naisys-supervisor/shared";

export const schemaRegistry: Record<string, $ZodType> = {
  CreateUser: CreateUserSchema,
  UpdateUser: UpdateUserSchema,
  GrantPermission: GrantPermissionSchema,
  LoginRequest: LoginRequestSchema,
};

// Register schemas with Zod global registry for OpenAPI components/schemas population
for (const [name, schema] of Object.entries(schemaRegistry)) {
  z.globalRegistry.add(schema, { id: name });
}
