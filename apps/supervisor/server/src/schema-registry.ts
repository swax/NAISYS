import { z } from "zod/v4";
import type { $ZodType } from "zod/v4/core";
import {
  AgentStartRequestSchema,
  CreateAgentConfigRequestSchema,
  UpdateAgentConfigRequestSchema,
  SetLeadAgentRequestSchema,
  SendMailRequestSchema,
  CreateUserSchema,
  UpdateUserSchema,
  GrantPermissionSchema,
  LoginRequestSchema,
  SettingsRequestSchema,
  SaveLlmModelRequestSchema,
  SaveImageModelRequestSchema,
} from "@naisys-supervisor/shared";

export const schemaRegistry: Record<string, $ZodType> = {
  CreateAgent: CreateAgentConfigRequestSchema,
  UpdateAgentConfig: UpdateAgentConfigRequestSchema,
  StartAgent: AgentStartRequestSchema,
  SetLeadAgent: SetLeadAgentRequestSchema,
  SendMail: SendMailRequestSchema,
  CreateUser: CreateUserSchema,
  UpdateUser: UpdateUserSchema,
  GrantPermission: GrantPermissionSchema,
  LoginRequest: LoginRequestSchema,
  SaveSettings: SettingsRequestSchema,
  SaveLlmModel: SaveLlmModelRequestSchema,
  SaveImageModel: SaveImageModelRequestSchema,
};

// Register schemas with Zod global registry for OpenAPI components/schemas population
for (const [name, schema] of Object.entries(schemaRegistry)) {
  z.globalRegistry.add(schema, { id: name });
}
