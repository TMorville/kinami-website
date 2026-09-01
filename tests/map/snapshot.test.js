import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SNAPSHOT_AGE_MS,
  createSnapshotStore,
  fetchSnapshot,
} from "../../dronereporter/map/src/snapshot.js";

const ID = "2026-09-01T10Z-abc123";
const GEN = "2026-09-01T10:02:11Z";

const artifacts = (overrides = {}) => ({
  "https://data.example/manifest.json": {
    schema_version: "1.1.0",
    snapshot_id: ID,
    generated_at: GEN,
    cutoff_at: "2026-09-01T09:02:00Z",
    min_delay_minutes: 60,
    reports_url: `snapshots/${ID}/reports.json`,
    stats_url: `snapshots/${ID}/stats.json`,
    ...overrides.manifest,
  },
  [`https://data.example/snapshots/${ID}/reports.json`]: {
    type: "FeatureCollection",
    schema_version: "1.1.0",
    snapshot_id: ID,
    generated_at: GEN,
    cutoff_at: "2026-09-01T09:02:00Z",
    features: [],
    ...overrides.reports,
  },
  [`https://data.example/snapshots/${ID}/stats.json`]: {
    schema_version: "1.1.0",
    snapshot_id: ID,
    generated_at: GEN,
    cutoff_at: "2026-09-01T09:02:00Z",
    total_reports: 0,
    reports_24h: 0,
    reports_7d: 0,
    active_cells_7d: 0,
    ...overrides.stats,
  },
});

const fetchFrom = (map) => async (url) => {
  if (!(url in map)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => map[url] };
};

test("fetchSnapshot resolves relative snapshot URLs against the manifest URL", async () => {
  const snapshot = await fetchSnapshot("https://data.example/manifest.json", {
    fetchImpl: fetchFrom(artifacts()),
  });
  assert.equal(snapshot.manifest.snapshot_id, ID);
  assert.equal(snapshot.stats.total_reports, 0);
});

test("fetchSnapshot rejects a snapshot_id disagreement", async () => {
  const bad = artifacts({ stats: { snapshot_id: "other" } });
  await assert.rejects(
    fetchSnapshot("https://data.example/manifest.json", { fetchImpl: fetchFrom(bad) }),
    /snapshot_id/,
  );
});

test("fetchSnapshot rejects a partial fetch (missing stats file)", async () => {
  const partial = artifacts();
  delete partial[`https://data.example/snapshots/${ID}/stats.json`];
  await assert.rejects(
    fetchSnapshot("https://data.example/manifest.json", { fetchImpl: fetchFrom(partial) }),
    /HTTP 404/,
  );
});

test("fetchSnapshot surfaces a hung fetch as TimeoutError, not AbortError", async () => {
  const hang = (url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  await assert.rejects(
    fetchSnapshot("https://data.example/manifest.json", { fetchImpl: hang, timeoutMs: 20 }),
    (error) => error.name === "TimeoutError",
  );
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness({ fetcher, nowIso = "2026-09-01T10:10:00Z", retry = [5, 10, 15], maxAgeMs = MAX_SNAPSHOT_AGE_MS }) {
  const states = [];
  let nowMs = Date.parse(nowIso);
  const store = createSnapshotStore({
    manifestUrl: "https://data.example/manifest.json",
    onState: (s) => states.push(s),
    fetcher,
    now: () => nowMs,
    refetchMs: 60_000,
    retryBackoffMs: retry,
    maxAgeMs,
  });
  return { store, states, setNow: (iso) => (nowMs = Date.parse(iso)) };
}

const goodSnapshot = (manifestOver = {}) => ({
  manifest: { generated_at: GEN, snapshot_id: ID, min_delay_minutes: 60, ...manifestOver },
  reports: { features: [], generated_at: GEN },
  stats: { total_reports: 0, reports_24h: 0, reports_7d: 0, active_cells_7d: 0 },
});

test("store: the cliff honors the snapshot's own max_age_minutes", async (t) => {
  // 30 h old: past the 24 h default, inside a 48 h producer promise.
  const { store, states, setNow } = harness({
    fetcher: async () => goodSnapshot({ max_age_minutes: 2880 }),
  });
  t.after(() => store.destroy());
  setNow(new Date(Date.parse(GEN) + 30 * 3_600_000).toISOString());
  store.start();
  await flush();
  assert.equal(states.at(-1).status, "ok");
});

test("store: success goes ok; failed refetch keeps last good as stale", async (t) => {
  let fail = false;
  const { store, states } = harness({
    fetcher: async () => {
      if (fail) throw new Error("network down");
      return goodSnapshot();
    },
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  assert.equal(states.at(-1).status, "ok");
  fail = true;
  await store.load("poll");
  assert.equal(states.at(-1).status, "stale");
  assert.equal(states.at(-1).snapshot.manifest.snapshot_id, ID);
});

test("store: a snapshot past the cliff refuses to render, even on the stale path", async (t) => {
  let fail = false;
  const { store, states, setNow } = harness({
    fetcher: async () => {
      if (fail) throw new Error("down");
      return goodSnapshot();
    },
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  fail = true;
  setNow("2026-09-02T11:00:00Z"); // > 24 h after GEN
  await store.load("poll");
  assert.deepEqual(states.at(-1), { status: "unavailable", reason: "too-old" });
});

test("store: visibility re-arms the retry ladder even after it exhausted", async (t) => {
  let calls = 0;
  const { store, states } = harness({
    fetcher: async () => {
      calls += 1;
      throw new Error("down");
    },
    retry: [5, 5, 5],
  });
  t.after(() => store.destroy());
  store.start();
  // Let the initial attempt plus all three ladder retries burn out.
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(states.at(-1).reason, "never-loaded");
  assert.ok(calls >= 4, `ladder did not run (calls ${calls})`);
  const before = calls;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, before, "ladder kept firing past exhaustion");
  // A returning visitor gets the fast path back: onVisible loads AND its
  // failure schedules a fresh ladder retry.
  store.onVisible();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(calls >= before + 2, `retry ladder dead after visibility failure (calls ${calls})`);
});

test("store: start is idempotent and dead after destroy", async () => {
  let calls = 0;
  const { store } = harness({
    fetcher: async () => {
      calls += 1;
      return goodSnapshot();
    },
  });
  store.start();
  store.start();
  await flush();
  assert.equal(calls, 1, "second start stacked another initial load");
  store.destroy();
  store.start();
  await flush();
  assert.equal(calls, 1, "start after destroy loaded again");
});

test("store: the expiry timer stamps too-old with no fetch settling", async (t) => {
  // Generated 10 ms before the cliff: the timer must fire on its own.
  const { store, states, setNow } = harness({
    fetcher: async () => goodSnapshot(),
    maxAgeMs: 30,
    nowIso: new Date(Date.parse(GEN) + 20).toISOString(),
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  assert.equal(states.at(-1).status, "ok");
  setNow(new Date(Date.parse(GEN) + 100).toISOString());
  // The timer carries a +50 ms boundary pad; wait past it.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(states.at(-1), { status: "unavailable", reason: "too-old" });
});

test("store: a slow older response never overwrites newer state", async (t) => {
  let resolveFirst;
  let call = 0;
  const { store, states } = harness({
    fetcher: () => {
      call += 1;
      if (call === 1) return new Promise((resolve) => (resolveFirst = resolve));
      return Promise.resolve(goodSnapshot());
    },
  });
  t.after(() => store.destroy());
  store.start();
  await flush();
  await store.load("poll"); // second call wins
  assert.equal(states.at(-1).status, "ok");
  const settled = states.length;
  resolveFirst(goodSnapshot()); // stale epoch resolves late
  await flush();
  assert.equal(states.length, settled, "stale epoch mutated state");
});

test("store: destroy clears everything and ignores in-flight results", async (t) => {
  let resolveIt;
  const { store, states } = harness({
    fetcher: () => new Promise((resolve) => (resolveIt = resolve)),
  });
  store.start();
  store.destroy();
  resolveIt(goodSnapshot());
  await flush();
  assert.equal(states.filter((s) => s.status === "ok").length, 0);
  t.after(() => {});
});
