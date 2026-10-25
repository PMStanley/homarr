import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getStatsSnapshotAsync, refreshStatsAsync } from "./stats";

const mocks = vi.hoisted(() => ({
  snapshots: new Map<string, unknown>(),
  locks: new Set<string>(),
  fetch: vi.fn(),
  generation: "generation",
}));
vi.mock("@homarr/integrations/stats", () => ({
  fetchStatsAsync: mocks.fetch,
  getStatsMetrics: () => [{ key: "sessions" }],
}));
vi.mock("./lib/integration-request-handler", () => ({
  getIntegrationCacheIdentity: ({ integration }: { integration: { id: string } }) => integration.id,
}));
vi.mock("@homarr/redis", () => ({
  getIntegrationCacheGenerationAsync: async () => ({ value: mocks.generation, isShared: true }),
  createGetSetChannel: (name: string) => ({ getAsync: async () => mocks.snapshots.get(name) }),
  createLockChannel: (name: string) => ({
    acquireAsync: async () => {
      if (mocks.locks.has(name)) return undefined;
      mocks.locks.add(name);
      return "token";
    },
    renewAsync: async () => true,
    releaseAsync: async () => mocks.locks.delete(name),
    setPersistentIfOwnedAsync: async (_token: string, key: string, value: unknown) => mocks.snapshots.set(key, value),
  }),
}));
const input = {
  id: "stats-cache-test",
  appId: null,
  kind: "jellyfin" as const,
  name: "Jellyfin",
  url: "http://jellyfin.test",
  externalUrl: null,
  decryptedSecrets: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
  mocks.snapshots.clear();
  mocks.locks.clear();
  mocks.fetch.mockReset().mockResolvedValue({ sessions: 1 });
});
afterEach(() => vi.useRealTimers());

describe("statistics cache refresh", () => {
  test("refreshes Jellyfin at 60 seconds and replaces playing with idle", async () => {
    expect((await getStatsSnapshotAsync(input)).stale).toBe(true);
    await refreshStatsAsync(input, false);
    vi.advanceTimersByTime(59_999);
    expect((await getStatsSnapshotAsync(input)).stale).toBe(false);
    await refreshStatsAsync(input, false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect((await getStatsSnapshotAsync(input)).stale).toBe(true);
    mocks.fetch.mockResolvedValue({ sessions: 0 });
    await refreshStatsAsync(input, false);
    expect(await getStatsSnapshotAsync(input)).toMatchObject({ values: { sessions: 0 }, stale: false });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test("retains the one-hour freshness window for unrelated statistics", async () => {
    const other = { ...input, kind: "sonarr" as const };
    await refreshStatsAsync(other, false);
    vi.advanceTimersByTime(60_000);
    expect((await getStatsSnapshotAsync(other)).stale).toBe(false);
    await refreshStatsAsync(other, false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_540_000);
    expect((await getStatsSnapshotAsync(other)).stale).toBe(true);
    await refreshStatsAsync(other, false);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  test("coalesces simultaneous refreshes and avoids refetching fresh data", async () => {
    await Promise.all(Array.from({ length: 10 }, () => refreshStatsAsync(input, false)));
    await refreshStatsAsync(input, false);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.locks.size).toBe(0);
  });

  test("respects a refresh owned by another process", async () => {
    mocks.locks.add(`integration-stats:lock:${input.id}`);
    await refreshStatsAsync(input, false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test("backs off failures while retaining the last good value", async () => {
    await refreshStatsAsync(input, false);
    vi.advanceTimersByTime(60_000);
    mocks.fetch.mockRejectedValue(new Error("Jellyfin unavailable"));
    await refreshStatsAsync(input, false);
    expect(await getStatsSnapshotAsync(input)).toMatchObject({ values: { sessions: 1 }, stale: true, error: true });
    await refreshStatsAsync(input, false);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    mocks.fetch.mockResolvedValue({ sessions: 0 });
    await refreshStatsAsync(input, false);
    expect(await getStatsSnapshotAsync(input)).toMatchObject({ values: { sessions: 0 }, error: false, stale: false });
  });

  test("manual refresh bypasses freshness", async () => {
    await refreshStatsAsync(input, false);
    await refreshStatsAsync(input, true);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
