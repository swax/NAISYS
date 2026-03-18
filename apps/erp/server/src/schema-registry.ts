import {
  ChangePasswordSchema,
  ClockOutLaborTicketSchema,
  CreateFieldSchema,
  CreateItemInstanceSchema,
  CreateItemSchema,
  CreateOperationDependencySchema,
  CreateOperationSchema,
  CreateOrderRevisionSchema,
  CreateOrderRunSchema,
  CreateOrderSchema,
  CreateStepSchema,
  CreateUserSchema,
  GrantPermissionSchema,
  LoginRequestSchema,
  UpdateFieldSchema,
  UpdateItemInstanceSchema,
  UpdateItemSchema,
  UpdateOperationRunSchema,
  UpdateOperationSchema,
  UpdateOrderRevisionSchema,
  UpdateOrderRunSchema,
  UpdateOrderSchema,
  UpdateStepFieldValueSchema,
  UpdateStepRunSchema,
  UpdateStepSchema,
  UpdateUserSchema,
} from "@naisys-erp/shared";
import { z } from "zod/v4";
import type { $ZodType } from "zod/v4/core";

export const schemaRegistry: Record<string, $ZodType> = {
  CreateItem: CreateItemSchema,
  UpdateItem: UpdateItemSchema,
  CreateItemInstance: CreateItemInstanceSchema,
  UpdateItemInstance: UpdateItemInstanceSchema,
  CreateOrder: CreateOrderSchema,
  UpdateOrder: UpdateOrderSchema,
  CreateOrderRevision: CreateOrderRevisionSchema,
  UpdateOrderRevision: UpdateOrderRevisionSchema,
  CreateOrderRun: CreateOrderRunSchema,
  UpdateOrderRun: UpdateOrderRunSchema,
  CreateOperation: CreateOperationSchema,
  CreateOperationDependency: CreateOperationDependencySchema,
  UpdateOperation: UpdateOperationSchema,
  UpdateOperationRun: UpdateOperationRunSchema,
  CreateStep: CreateStepSchema,
  UpdateStep: UpdateStepSchema,
  CreateField: CreateFieldSchema,
  UpdateField: UpdateFieldSchema,
  UpdateStepFieldValue: UpdateStepFieldValueSchema,
  UpdateStepRun: UpdateStepRunSchema,
  LoginRequest: LoginRequestSchema,
  CreateUser: CreateUserSchema,
  UpdateUser: UpdateUserSchema,
  GrantPermission: GrantPermissionSchema,
  ChangePassword: ChangePasswordSchema,
  ClockOutLaborTicket: ClockOutLaborTicketSchema,
};

// Register schemas with Zod global registry for OpenAPI components/schemas population
for (const [name, schema] of Object.entries(schemaRegistry)) {
  z.globalRegistry.add(schema, { id: name });
}
