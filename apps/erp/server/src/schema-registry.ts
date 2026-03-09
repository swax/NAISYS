import {
  CreateOrderRunSchema,
  CreateOrderRevisionSchema,
  CreateOrderSchema,
  LoginRequestSchema,
  UpdateOrderRunSchema,
  UpdateOrderRevisionSchema,
  UpdateOrderSchema,
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
  LoginRequest: LoginRequestSchema,
};

// Register schemas with Zod global registry for OpenAPI components/schemas population
for (const [name, schema] of Object.entries(schemaRegistry)) {
  z.globalRegistry.add(schema, { id: name });
}
