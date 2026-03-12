import {
  ChangePasswordSchema,
  CreateOperationSchema,
  CreateOrderRevisionSchema,
  CreateOrderRunSchema,
  CreateOrderSchema,
  CreateStepFieldSchema,
  CreateStepSchema,
  CreateUserSchema,
  GrantPermissionSchema,
  LoginRequestSchema,
  UpdateOperationRunSchema,
  UpdateOperationSchema,
  UpdateOrderRevisionSchema,
  UpdateOrderRunSchema,
  UpdateOrderSchema,
  UpdateStepFieldSchema,
  UpdateStepFieldValueSchema,
  UpdateStepRunSchema,
  UpdateStepSchema,
  UpdateUserSchema,
} from "@naisys-erp/shared";
import { z } from "zod/v4";
import type { $ZodType } from "zod/v4/core";

export const schemaRegistry: Record<string, $ZodType> = {
  CreateOrder: CreateOrderSchema,
  UpdateOrder: UpdateOrderSchema,
  CreateOrderRevision: CreateOrderRevisionSchema,
  UpdateOrderRevision: UpdateOrderRevisionSchema,
  CreateOrderRun: CreateOrderRunSchema,
  UpdateOrderRun: UpdateOrderRunSchema,
  CreateOperation: CreateOperationSchema,
  UpdateOperation: UpdateOperationSchema,
  UpdateOperationRun: UpdateOperationRunSchema,
  CreateStep: CreateStepSchema,
  UpdateStep: UpdateStepSchema,
  CreateStepField: CreateStepFieldSchema,
  UpdateStepField: UpdateStepFieldSchema,
  UpdateStepFieldValue: UpdateStepFieldValueSchema,
  UpdateStepRun: UpdateStepRunSchema,
  LoginRequest: LoginRequestSchema,
  CreateUser: CreateUserSchema,
  UpdateUser: UpdateUserSchema,
  GrantPermission: GrantPermissionSchema,
  ChangePassword: ChangePasswordSchema,
};

// Register schemas with Zod global registry for OpenAPI components/schemas population
for (const [name, schema] of Object.entries(schemaRegistry)) {
  z.globalRegistry.add(schema, { id: name });
}
