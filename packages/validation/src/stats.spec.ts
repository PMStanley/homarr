import { expect, test } from "vitest";

import { statsCacheDurationSecondsSchema, statsCheckIntervalSecondsSchema } from "./stats";

test("accepts automatic caching and bounded custom intervals", () => {
  expect(statsCacheDurationSecondsSchema.parse(0)).toBe(0);
  for (const seconds of [5, 10, 60, 3600, 86_400]) {
    expect(statsCacheDurationSecondsSchema.parse(seconds)).toBe(seconds);
    expect(statsCheckIntervalSecondsSchema.parse(seconds)).toBe(seconds);
  }
});

test("rejects intervals that bypass limits or cause excessively frequent requests", () => {
  for (const seconds of [-1, 1, 4, 5.5, 86_401, Infinity, NaN, "60"]) {
    expect(statsCacheDurationSecondsSchema.safeParse(seconds).success).toBe(false);
    expect(statsCheckIntervalSecondsSchema.safeParse(seconds).success).toBe(false);
  }
  expect(statsCheckIntervalSecondsSchema.safeParse(0).success).toBe(false);
});
