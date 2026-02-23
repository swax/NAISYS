import {
  CreateExecutionOrderSchema,
  CreatePlanningOrderRevisionSchema,
  CreatePlanningOrderSchema,
  LoginRequestSchema,
  UpdateExecutionOrderSchema,
  UpdatePlanningOrderRevisionSchema,
  UpdatePlanningOrderSchema,
} from "@naisys-erp/shared";
import { z } from "zod/v4";
import type { $ZodType } from "zod/v4/core";

export const schemaRegistry: Record<string, $ZodType> = {
  CreatePlanningOrder: CreatePlanningOrderSchema,
  UpdatePlanningOrder: UpdatePlanningOrderSchema,
  CreatePlanningOrderRevision: CreatePlanningOrderRevisionSchema,
  UpdatePlanningOrderRevision: UpdatePlanningOrderRevisionSchema,
  CreateExecutionOrder: CreateExecutionOrderSchema,
  UpdateExecutionOrder: UpdateExecutionOrderSchema,
  LoginRequest: LoginRequestSchema,
};

// Register schemas with Zod global registry for OpenAPI components/schemas population
for (const [name, schema] of Object.entries(schemaRegistry)) {
  z.globalRegistry.add(schema, { id: name });
}
