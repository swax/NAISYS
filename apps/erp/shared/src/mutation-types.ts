/**
 * Slim response schemas for POST/PUT/DELETE mutations.
 *
 * By default, mutations return a slim response (identifiers + _actions).
 * Callers can send `Prefer: return=representation` to get the full entity
 * response instead (useful for UI clients that patch state in place).
 */
import { z } from "zod/v4";

import { HateoasActionSchema, HateoasLinkSchema } from "./hateoas-types.js";
import { OperationRunStatusEnum } from "./operation-run-types.js";
import { RevisionStatusEnum } from "./order-revision-types.js";
import { OrderRunStatusEnum } from "./order-run-types.js";
import { FieldValidationSchema, FieldValueSchema } from "./step-run-types.js";

// ── Base mutation responses ─────────────────────────────────────────

/** PUT / generic mutation — just updated actions */
export const MutateResponseSchema = z.object({
  _actions: z.array(HateoasActionSchema).optional(),
});
export type MutateResponse = z.infer<typeof MutateResponseSchema>;

/** POST create — server-generated id + self link + actions */
export const CreateResponseSchema = MutateResponseSchema.extend({
  id: z.number(),
  _links: z.array(HateoasLinkSchema).optional(),
});
export type CreateResponse = z.infer<typeof CreateResponseSchema>;

// ── Entity create variants ──────────────────────────────────────────

/** Orders, items, work centers, item instances (key-based) */
export const KeyCreateResponseSchema = CreateResponseSchema.extend({
  key: z.string(),
});

/** Operations, steps, fields, field refs (seqNo-based) */
export const SeqNoCreateResponseSchema = CreateResponseSchema.extend({
  seqNo: z.number(),
});

/** Batch create (steps, fields) */
export const BatchSeqNoCreateResponseSchema = z.object({
  items: z.array(z.object({ id: z.number(), seqNo: z.number() })),
  total: z.number(),
  _actions: z.array(HateoasActionSchema).optional(),
});

/** Order revision create */
export const RevisionCreateResponseSchema = CreateResponseSchema.extend({
  revNo: z.number(),
});

/** Order run create */
export const RunCreateResponseSchema = CreateResponseSchema.extend({
  runNo: z.number(),
});

/** User create (ERP) */
export const UserCreateResponseSchema = z.object({
  id: z.number(),
  username: z.string(),
  apiKey: z.string().nullable().optional(),
  _links: z.array(HateoasLinkSchema).optional(),
  _actions: z.array(HateoasActionSchema).optional(),
});
export type UserCreateResponse = z.infer<typeof UserCreateResponseSchema>;

// ── Transition responses ────────────────────────────────────────────

/** Order run transition (start / close / complete / cancel / reopen) */
export const OrderRunTransitionSchema = z.object({
  status: OrderRunStatusEnum,
  _actions: z.array(HateoasActionSchema).optional(),
});
export type OrderRunTransition = z.infer<typeof OrderRunTransitionSchema>;

/** Operation run transition (start / complete / skip / fail / reopen) */
export const OperationRunTransitionSlimSchema = z.object({
  status: OperationRunStatusEnum,
  _actions: z.array(HateoasActionSchema).optional(),
});

/** Step run transition (complete / reopen) */
export const StepRunTransitionSlimSchema = z.object({
  completed: z.boolean(),
  _actions: z.array(HateoasActionSchema).optional(),
});

/** Order revision transition (approve / obsolete) */
export const OrderRevisionTransitionSchema = z.object({
  status: RevisionStatusEnum,
  _actions: z.array(HateoasActionSchema).optional(),
});
export type OrderRevisionTransition = z.infer<
  typeof OrderRevisionTransitionSchema
>;

// ── Field value mutation responses ──────────────────────────────────

/** Single field value PUT — echo value + validation + actions */
export const FieldValueMutateResponseSchema = z.object({
  value: FieldValueSchema,
  validation: FieldValidationSchema,
  _actions: z.array(HateoasActionSchema).optional(),
});
export type FieldValueMutateResponse = z.infer<
  typeof FieldValueMutateResponseSchema
>;

/** Batch field value PUT */
export const BatchFieldValueMutateResponseSchema = z.object({
  items: z.array(
    z.object({
      fieldSeqNo: z.number(),
      value: FieldValueSchema,
      validation: FieldValidationSchema,
    }),
  ),
  total: z.number(),
  _actions: z.array(HateoasActionSchema).optional(),
});
export type BatchFieldValueMutateResponse = z.infer<
  typeof BatchFieldValueMutateResponseSchema
>;

/** Delete field value set */
export const DeleteSetMutateResponseSchema = z.object({
  setCount: z.number(),
  _actions: z.array(HateoasActionSchema).optional(),
});
export type DeleteSetMutateResponse = z.infer<
  typeof DeleteSetMutateResponseSchema
>;
