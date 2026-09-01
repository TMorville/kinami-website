// dronereporter/map/src/snapshot.js
import {
  UnsupportedSchemaError,
  MalformedPayloadError,
  parseManifest,
  parseReports,
  parseStats,
} from "./contract.js";

/**
 * Upper bound on one whole snapshot fetch. Without it a hung connection never
 * settles and the page could sit on "ok" with a frozen "updated X ago"
 * indefinitely. Aborts with TimeoutError, deliberately NOT AbortError:
 * callers swallow AbortError as supersession, a timeout must surface.
 */
export const FETCH_TIMEOUT_MS = 30_000;

/** Matched to the manifest's 300 s TTL, so a poll is an edge-cache hit. */
export const REFETCH_INTERVAL_MS = 300_000;

/** First-load retry ladder before settling into the steady cadence. */
export const RETRY_BACKOFF_MS = [2_000, 5_000, 15_000];

/** Past this, the surface refuses to render rather than look fresh. */
export const MAX_SNAPSHOT_AGE_MS = 86_400_000; // 24 h

async function getJson(url, signal, fetchImpl) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Fetches one complete snapshot, or throws. Contract rules enforced here and
 * nowhere else: all-or-nothing; follow (never construct) snapshot URLs,
 * resolved against the manifest URL; one publish, not a mixture, so all
 * three artifacts must carry the manifest's snapshot_id.
 */
export async function fetchSnapshot(
  manifestUrl,
  { signal, fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {},
) {
  const ac = new AbortController();
  const onCallerAbort = () => ac.abort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
  if (signal?.aborted) onCallerAbort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(
    () => ac.abort(new DOMException(`Snapshot fetch exceeded ${timeoutMs} ms`, "TimeoutError")),
    timeoutMs,
  );

  try {
    const manifest = parseManifest(await getJson(manifestUrl, ac.signal, fetchImpl));

    const base = new URL(manifestUrl, globalThis.location?.href);
    const reportsUrl = new URL(manifest.reports_url, base).toString();
    const statsUrl = new URL(manifest.stats_url, base).toString();

    const [reportsRaw, statsRaw] = await Promise.all([
      getJson(reportsUrl, ac.signal, fetchImpl),
      getJson(statsUrl, ac.signal, fetchImpl),
    ]);

    const reports = parseReports(reportsRaw);
    const stats = parseStats(statsRaw);

    for (const [name, id] of [
      ["reports", reports.snapshot_id],
      ["stats", stats.snapshot_id],
    ]) {
      if (id !== manifest.snapshot_id) {
        throw new MalformedPayloadError(
          `${name} snapshot_id "${id}" does not match manifest "${manifest.snapshot_id}"`,
        );
      }
    }

    return { manifest, reports, stats };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
    // Promise.all rejects on the first failure but does not cancel the
    // sibling request. Abort the private controller so no request outlives
    // this call; after success the abort is a no-op.
    ac.abort(new DOMException("Snapshot fetch settled", "AbortError"));
  }
}

/**
 * Owns the four states the page's live layer can be in. The invariant:
 * never render blank, never render something that looks fresher than it is.
 *
 * Explicit-owner contract (no React lifecycle to lean on):
 *  - every trigger bumps the epoch and aborts its predecessor; only the
 *    current epoch may mutate state or schedule a retry
 *  - at most one retry timeout, one poll interval, one expiry timer, one
 *    AbortController at any time; any success cancels a scheduled retry
 *  - never-loaded failures re-enter the retry ladder from ANY trigger
 *  - the expiry timer holds the 24 h cliff when no fetch settles, and
 *    re-verifies against current state before stamping too-old
 *  - destroy() aborts, clears every timer, bumps the epoch
 */
export function createSnapshotStore({
  manifestUrl,
  onState,
  fetcher = fetchSnapshot,
  now = () => Date.now(),
  refetchMs = REFETCH_INTERVAL_MS,
  retryBackoffMs = RETRY_BACKOFF_MS,
  maxAgeMs = MAX_SNAPSHOT_AGE_MS,
}) {
  let state = { status: "loading" };
  let lastGood = null;
  let epoch = 0;
  let failures = 0;
  let controller = null;
  let retryTimer = null;
  let pollTimer = null;
  let expiryTimer = null;
  let destroyed = false;

  // The cliff is the snapshot's OWN freshness promise when it carries one
  // (manifest max_age_minutes, already clamped by the parser); the maxAgeMs
  // option is the default for manifests without the field.
  const allowanceMs = (snapshot) =>
    snapshot.manifest.max_age_minutes !== undefined
      ? snapshot.manifest.max_age_minutes * 60_000
      : maxAgeMs;
  const isTooOld = (snapshot) =>
    now() - Date.parse(snapshot.manifest.generated_at) > allowanceMs(snapshot);

  function scheduleExpiry() {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    if (state.status !== "ok" && state.status !== "stale") return;
    const expiresInMs =
      Date.parse(state.snapshot.manifest.generated_at) + allowanceMs(state.snapshot) - now();
    // +50 ms pad: the timer must observe a time PAST the boundary, or the
    // strict > in isTooOld leaves the callback a no-op with nothing re-armed.
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      // Re-verify against whatever state is current: a callback queued for a
      // previous snapshot must not stamp too-old over data that is not.
      if (state.status !== "ok" && state.status !== "stale") return;
      if (isTooOld(state.snapshot)) {
        setState({ status: "unavailable", reason: "too-old" });
      } else {
        scheduleExpiry(); // still fresh (clock moved); re-arm
      }
    }, Math.max(0, expiresInMs) + 50);
  }

  function setState(next) {
    state = next;
    scheduleExpiry();
    onState(state);
  }

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleRetry() {
    const delay = retryBackoffMs[failures - 1];
    if (lastGood === null && delay !== undefined && retryTimer === null && !destroyed) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void load("retry");
      }, delay);
    }
  }

  async function load(trigger) {
    if (destroyed) return;
    const mine = ++epoch;
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    clearRetry(); // this attempt owns retrying now

    try {
      const snapshot = await fetcher(manifestUrl, { signal: ac.signal });
      if (mine !== epoch || destroyed) return;
      if (isTooOld(snapshot)) {
        setState({ status: "unavailable", reason: "too-old" });
        return;
      }
      failures = 0;
      lastGood = snapshot;
      setState({ status: "ok", snapshot });
    } catch (error) {
      if (mine !== epoch || destroyed) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof UnsupportedSchemaError) {
        setState({ status: "unavailable", reason: "unsupported-schema" });
        return;
      }
      // A failed refetch must not discard a good snapshot, but the cliff
      // applies to it all the same.
      if (lastGood) {
        setState(
          isTooOld(lastGood)
            ? { status: "unavailable", reason: "too-old" }
            : { status: "stale", snapshot: lastGood },
        );
        return;
      }
      failures += 1;
      setState({ status: "unavailable", reason: "never-loaded" });
      scheduleRetry();
    }
  }

  let started = false;
  function start() {
    // Idempotent, and dead after destroy: a second call must not stack a
    // second poll interval.
    if (started || destroyed) return;
    started = true;
    void load("initial");
    pollTimer = setInterval(() => void load("poll"), refetchMs);
  }

  function onVisible() {
    // Re-check the cliff synchronously before a retained snapshot shows again.
    if ((state.status === "ok" || state.status === "stale") && isTooOld(state.snapshot)) {
      setState({ status: "unavailable", reason: "too-old" });
    }
    // A returning visitor re-arms the quick retry ladder: after the ladder
    // exhausted (failures past its length), only the 5-minute poll would
    // retry, and someone who just switched back deserves the fast path.
    if (lastGood === null) failures = 0;
    void load("visibility");
  }

  function destroy() {
    destroyed = true;
    epoch += 1;
    controller?.abort();
    clearRetry();
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  return { start, load, onVisible, destroy, getState: () => state };
}
