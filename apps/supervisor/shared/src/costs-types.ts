import { z } from "zod";

export const CostsHistogramRequestSchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  bucketHours: z.coerce.number().optional(),
  leadUsername: z.string().optional(),
});

export type CostsHistogramRequest = z.infer<typeof CostsHistogramRequestSchema>;

export const CostBucketSchema = z.object({
  start: z.string(),
  end: z.string(),
  cost: z.number(),
  byAgent: z.record(z.string(), z.number()),
});

export type CostBucket = z.infer<typeof CostBucketSchema>;

export const CostByAgentSchema = z.object({
  username: z.string(),
  title: z.string(),
  cost: z.number(),
});

export type CostByAgent = z.infer<typeof CostByAgentSchema>;

export const CostsHistogramResponseSchema = z.object({
  spendLimitDollars: z.number().nullable(),
  spendLimitHours: z.number().nullable(),
  buckets: z.array(CostBucketSchema),
  byAgent: z.array(CostByAgentSchema),
});

export type CostsHistogramResponse = z.infer<
  typeof CostsHistogramResponseSchema
>;
