// @vitest-environment node
import type { SessionInfoDto } from "@jellyfin/sdk/lib/generated-client/models";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { JellyfinIntegration } from "../jellyfin/jellyfin-integration";
import { existingStatsProviders } from "./existing";

const mocks = vi.hoisted(() => ({ getSessions: vi.fn(), createIntegrationAsync: vi.fn() }));
vi.mock("@homarr/core/infrastructure/certificates", () => ({
  getTrustedCertificateHostnamesAsync: vi.fn().mockResolvedValue([]),
  getAllTrustedCertificatesAsync: vi.fn().mockResolvedValue([]),
}));
vi.mock("@jellyfin/sdk/lib/utils/api/session-api", () => ({
  getSessionApi: () => ({ getSessions: mocks.getSessions }),
}));
vi.mock("../factory", () => ({ createIntegrationAsync: mocks.createIntegrationAsync }));

const input = {
  id: "jellyfin-stats",
  name: "Jellyfin",
  url: "http://jellyfin.test",
  externalUrl: null,
  decryptedSecrets: [{ kind: "apiKey" as const, value: "test-key" }],
};
// The live API returns null for idle clients although the SDK only declares undefined.
type SessionResponse = Omit<SessionInfoDto, "NowPlayingItem"> & {
  NowPlayingItem: SessionInfoDto["NowPlayingItem"] | null;
};
const session = (playing: boolean, paused = false): SessionResponse => ({
  Id: "safari",
  UserId: "user",
  DeviceId: "safari",
  NowPlayingItem: playing ? { Name: "Tomorrow's Enterprise", Type: "Episode" } : null,
  PlayState: { IsPaused: paused },
});
const fetchStats = () => existingStatsProviders.jellyfin?.fetchAsync(input, new AbortController().signal);

beforeEach(() => {
  mocks.createIntegrationAsync.mockResolvedValue(new JellyfinIntegration(input));
});

describe("Jellyfin playback statistics", () => {
  test.each([
    ["idle Safari", [session(false)], 0],
    ["one playing stream", [session(true)], 1],
    ["two playing streams", [session(true), { ...session(true), Id: "second" }], 2],
    ["paused stream", [session(true, true)], 0],
    ["mixed sessions", [session(false), session(true), session(true, true)], 1],
  ])("counts %s", async (_scenarioName, sessions, expectedSessionCount) => {
    mocks.getSessions.mockResolvedValue({ data: sessions });
    expect(await fetchStats()).toEqual({ sessions: expectedSessionCount });
  });

  test("stopping playback clears the count while the client remains connected", async () => {
    mocks.getSessions.mockResolvedValueOnce({ data: [session(true)] });
    expect(await fetchStats()).toEqual({ sessions: 1 });
    mocks.getSessions.mockResolvedValueOnce({ data: [session(false)] });
    expect(await fetchStats()).toEqual({ sessions: 0 });
  });

  test("showOnlyPlaying excludes both null and missing now-playing items", async () => {
    mocks.getSessions.mockResolvedValue({
      data: [session(false), { ...session(false), NowPlayingItem: undefined }, session(true)],
    });
    const client = new JellyfinIntegration(input);
    expect(await client.getCurrentSessionsAsync({ showOnlyPlaying: true })).toHaveLength(1);
  });

  test.each(["plex", "emby"] as const)("preserves %s session counting", async (kind) => {
    const getCurrentSessionsAsync = vi
      .fn()
      .mockResolvedValue([{ currentlyPlaying: null }, { currentlyPlaying: { playback: { state: "paused" } } }]);
    mocks.createIntegrationAsync.mockResolvedValue({ getCurrentSessionsAsync });
    expect(await existingStatsProviders[kind]?.fetchAsync(input, new AbortController().signal)).toEqual({
      sessions: 2,
    });
    expect(getCurrentSessionsAsync).toHaveBeenCalledWith({ showOnlyPlaying: false });
  });
});
