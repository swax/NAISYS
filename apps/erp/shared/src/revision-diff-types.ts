import { z } from "zod/v4";

// A single changed property
export const PropertyChangeSchema = z.object({
  field: z.string(),
  from: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  to: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export type PropertyChange = z.infer<typeof PropertyChangeSchema>;

export const DiffStatusEnum = z.enum([
  "added",
  "removed",
  "modified",
  "unchanged",
]);
export type DiffStatus = z.infer<typeof DiffStatusEnum>;

// Field-level diff
export const FieldDiffSchema = z.object({
  seqNo: z.number(),
  label: z.string(),
  status: DiffStatusEnum,
  changes: z.array(PropertyChangeSchema).optional(),
});

export type FieldDiff = z.infer<typeof FieldDiffSchema>;

// Step-level diff
export const StepDiffSchema = z.object({
  seqNo: z.number(),
  title: z.string(),
  status: DiffStatusEnum,
  changes: z.array(PropertyChangeSchema).optional(),
  fields: z.array(FieldDiffSchema).optional(),
});

export type StepDiff = z.infer<typeof StepDiffSchema>;

// Dependency diff
export const DependencyDiffSchema = z.object({
  predecessorSeqNo: z.number(),
  predecessorTitle: z.string(),
  status: z.enum(["added", "removed", "unchanged"]),
});

export type DependencyDiff = z.infer<typeof DependencyDiffSchema>;

// Operation-level diff
export const OperationDiffSchema = z.object({
  seqNo: z.number(),
  title: z.string(),
  status: DiffStatusEnum,
  changes: z.array(PropertyChangeSchema).optional(),
  steps: z.array(StepDiffSchema).optional(),
  dependencies: z.array(DependencyDiffSchema).optional(),
});

export type OperationDiff = z.infer<typeof OperationDiffSchema>;

// Top-level diff response
export const RevisionDiffResponseSchema = z.object({
  fromRevNo: z.number(),
  toRevNo: z.number(),
  revisionChanges: z.array(PropertyChangeSchema),
  operations: z.array(OperationDiffSchema),
});

export type RevisionDiffResponse = z.infer<typeof RevisionDiffResponseSchema>;

// Query params
export const RevisionDiffQuerySchema = z.object({
  from: z.coerce.number().int().min(1),
  to: z.coerce.number().int().min(1),
});

export type RevisionDiffQuery = z.infer<typeof RevisionDiffQuerySchema>;
