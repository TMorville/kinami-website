// tests/map/format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, formatDelay, relativeTime } from "../../dronereporter/map/src/format.js";

const now = Date.parse("2026-09-01T12:00:00Z");

test("relativeTime phrases", () => {
  assert.equal(relativeTime("2026-09-01T11:59:40Z", now), "just now");
  assert.equal(relativeTime("2026-09-01T11:15:00Z", now), "45 min ago");
  assert.equal(relativeTime("2026-09-01T11:00:00Z", now), "1 hour ago");
  assert.equal(relativeTime("2026-09-01T04:00:00Z", now), "8 hours ago");
  assert.equal(relativeTime("2026-08-30T12:00:00Z", now), "2 days ago");
  // A future timestamp never reads as negative.
  assert.equal(relativeTime("2026-09-01T13:00:00Z", now), "just now");
});

test("formatDelay reproduces the pinned disclosure copy at the contract default", () => {
  assert.equal(formatDelay(60), "1 hour");
  assert.equal(formatDelay(120), "2 hours");
  assert.equal(formatDelay(45), "45 minutes");
  assert.equal(formatDelay(1), "1 minute");
});

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml(`<a b="c">&'`), "&lt;a b=&quot;c&quot;&gt;&amp;&#39;");
});
