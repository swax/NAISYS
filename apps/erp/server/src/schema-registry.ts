import {
  CreateOrderRunSchema,
  CreateOrderRevisionSchema,
  CreatePlanningOrderSchema,
  LoginRequestSchema,
  UpdateOrderRunSchema,
  UpdateOrderRevisionSchema,
  UpdatePlanningOrderSchema,
} from "@naisys-erp/shared";
import { z } from "zod/v4";
import type { $ZodType } from "zod/v4/core";

export const schemaRegistry: Record<string, $ZodType> = {
  CreatePlanningOrder: CreatePlanningOrderSchema,
  UpdatePlanningOrder: UpdatePlanningOrderSchema,
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
