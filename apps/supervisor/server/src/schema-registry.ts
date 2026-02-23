import {
  AgentStartRequestSchema,
  ChangePasswordSchema,
  CreateAgentConfigRequestSchema,
  CreateUserSchema,
  GrantPermissionSchema,
  LoginRequestSchema,
  SaveImageModelRequestSchema,
  SaveLlmModelRequestSchema,
  SaveVariableRequestSchema,
  SendChatRequestSchema,
  SendMailRequestSchema,
  SetLeadAgentRequestSchema,
  UpdateAgentConfigRequestSchema,
  UpdateUserSchema,
} from "@naisys-supervisor/shared";
import { z } from "zod/v4";
import type { $ZodType } from "zod/v4/core";

export const schemaRegistry: Record<string, $ZodType> = {
  CreateAgent: CreateAgentConfigRequestSchema,
  UpdateAgentConfig: UpdateAgentConfigRequestSchema,
  StartAgent: AgentStartRequestSchema,
  SetLeadAgent: SetLeadAgentRequestSchema,
  SendChat: SendChatRequestSchema,
  SendMail: SendMailRequestSchema,
  ChangePassword: ChangePasswordSchema,
  CreateUser: CreateUserSchema,
  UpdateUser: UpdateUserSchema,
  GrantPermission: GrantPermissionSchema,
  LoginRequest: LoginRequestSchema,
  SaveLlmModel: SaveLlmModelRequestSchema,
  SaveImageModel: SaveImageModelRequestSchema,
  SaveVariable: SaveVariableRequestSchema,
};

// Register schemas with Zod global registry for OpenAPI components/schemas population
for (const [name, schema] of Object.entries(schemaRegistry)) {
  z.globalRegistry.add(schema, { id: name });
}
