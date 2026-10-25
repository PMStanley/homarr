import { z as schema } from "zod/v4";

export const statsCheckIntervalSecondsSchema = schema.number().int().min(5).max(86_400);

// Zero keeps the integration's default cache lifetime.
export const statsCacheDurationSecondsSchema = schema
  .number()
  .int()
  .min(0)
  .max(86_400)
  .refine((seconds) => seconds === 0 || seconds >= 5, {
    message: "Use 0 for automatic caching, or between 5 and 86400 seconds",
  });
