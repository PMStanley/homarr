import type { ComponentProps } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import StatsWidget from "./component";

const mocks = vi.hoisted(() => ({
  snapshot: { values: { sessions: 1 }, updatedAt: 1, stale: true, retryAt: 0, error: false, freshUntil: 60_001 },
  pollInterval: vi.fn(),
  Empty: () => null,
  mutate: vi.fn(),
  getData: vi.fn(),
  cancel: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@homarr/boards/context", () => ({ useRequiredBoard: () => ({ id: "board" }) }));
vi.mock("@homarr/translation/client", () => ({ useI18n: () => (key: string) => key }));
vi.mock("../demo-read-only", () => ({ useDemoReadOnly: () => false }));
vi.mock("../runtime-hooks", () => ({ useWidgetRuntimeActions: () => undefined }));
vi.mock("./table", () => ({ StatsTable: () => null }));
vi.mock("./details", () => ({ StatsDetails: () => null }));
vi.mock("./loading", () => ({ StatsLoading: () => null }));
vi.mock("@mantine/core", () => {
  const Empty = mocks.Empty;
  return {
    ActionIcon: Empty,
    Avatar: Empty,
    Button: Empty,
    Checkbox: Empty,
    Group: Empty,
    Popover: Object.assign(Empty, { Target: Empty, Dropdown: Empty }),
    ScrollArea: Object.assign(Empty, { Autosize: Empty }),
    Stack: Empty,
    Switch: Empty,
    Text: Empty,
    Tooltip: Empty,
  };
});
vi.mock("@homarr/api/client", () => {
  const utils = {
    client: { widget: { stats: { refresh: { mutate: mocks.mutate } } } },
    widget: {
      stats: {
        snapshot: {
          getData: mocks.getData,
          cancel: mocks.cancel,
          setData: mocks.setData,
          invalidate: mocks.invalidate,
        },
      },
    },
  };
  return {
    clientApi: {
      useUtils: () => utils,
      useQueries: (callback: (api: unknown) => unknown) =>
        callback({
          widget: {
            stats: {
              catalog: () => ({
                data: { name: "Jellyfin", metrics: [{ key: "sessions", label: "Sessions", unit: "count" }] },
              }),
              snapshot: (
                _input: unknown,
                options: { refetchInterval: (query: { state: { data: typeof mocks.snapshot } }) => number },
              ) => {
                mocks.pollInterval(options.refetchInterval({ state: { data: mocks.snapshot } }));
                return { data: mocks.snapshot };
              },
            },
          },
        }),
    },
  };
});
const props = {
  integrationIds: ["jellyfin"],
  isEditMode: false,
  width: 300,
  options: {
    entries: [{ id: "streams", integrationId: "jellyfin", metric: "sessions" }],
    table: true,
    rows: false,
    plain: false,
    showIcon: false,
    spacing: "xs",
  },
} as ComponentProps<typeof StatsWidget>;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  mocks.snapshot = {
    values: { sessions: 1 },
    updatedAt: 1,
    stale: true,
    retryAt: 0,
    error: false,
    freshUntil: Date.now() + 60_000,
  };
  mocks.getData.mockImplementation(() => mocks.snapshot);
  mocks.mutate.mockResolvedValue({ ...mocks.snapshot, stale: false });
  mocks.setData.mockImplementation((_input, snapshot: typeof mocks.snapshot) => {
    mocks.snapshot = snapshot;
  });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

test("automatically refreshes an existing stale snapshot once per integration", async () => {
  await act(async () => root.render(<StatsWidget {...props} integrationIds={["jellyfin", "jellyfin"]} />));
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ integrationId: "jellyfin", force: false });
  expect(mocks.setData).toHaveBeenCalledOnce();
});
test("does not refresh a fresh snapshot", async () => {
  mocks.snapshot.stale = false;
  await act(async () => root.render(<StatsWidget {...props} />));
  expect(mocks.mutate).not.toHaveBeenCalled();
});
test("honors the server retry backoff", async () => {
  mocks.snapshot.retryAt = Date.now() + 60_000;
  await act(async () => root.render(<StatsWidget {...props} />));
  expect(mocks.mutate).not.toHaveBeenCalled();
});

test("polls at snapshot expiry instead of waiting an extra minute", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
  try {
    mocks.snapshot.stale = false;
    mocks.snapshot.freshUntil = 123_000;
    await act(async () => root.render(<StatsWidget {...props} />));
    expect(mocks.pollInterval).toHaveBeenLastCalledWith(23_000);
  } finally {
    now.mockRestore();
  }
});

test("response latency does not defer the next refresh past server expiry", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
  try {
    mocks.mutate.mockResolvedValue({ ...mocks.snapshot, updatedAt: 99_900, freshUntil: 159_900, stale: false });
    await act(async () => root.render(<StatsWidget {...props} />));
    now.mockReturnValue(159_900);
    mocks.snapshot = { ...mocks.snapshot, stale: true };
    await act(async () => root.render(<StatsWidget {...props} />));
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  } finally {
    now.mockRestore();
  }
});
