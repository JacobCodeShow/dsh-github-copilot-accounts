import { test } from "node:test";
import assert from "node:assert/strict";
import { accountQuotaRemaining } from "../src/session-badge-state.mjs";

test("menu balance comes from each individual account, including unselected accounts", () => {
  const a = { id: "A", usage: { percentUsed: 12 } }, b = { id: "B", globalActive: true, usage: { percentUsed: 78 } };
  assert.equal(accountQuotaRemaining(a).text, "88%");
  assert.equal(accountQuotaRemaining(b).text, "22%");
  assert.equal(accountQuotaRemaining({ ...a, routeAvailable: false }).text, "88%", "route configuration does not erase account credit");
});

test("unlimited quota wins over placeholder percentage and uses a compact infinity symbol", () => {
  assert.deepEqual(accountQuotaRemaining({ usage: { unlimited: true, percentUsed: 100 } }), { text: "∞", kind: "unlimited" });
});

test("failed, absent or invalid usage never becomes a misleading zero balance", () => {
  for (const account of [undefined, {}, { usage: {} }, { usageError: "unavailable", usage: { percentUsed: 5 } },
    { available: false, usage: { unlimited: true } }, { usage: { percentUsed: NaN } }, { usage: { percentUsed: Infinity } },
    { usage: { percentUsed: "12" } }, { usage: { remaining: Infinity, entitlement: 100 } }]) {
    assert.deepEqual(accountQuotaRemaining(account), { text: "—", kind: "unknown" });
  }
});

test("zero, rounded/clamped percentage and count-only fallback retain their meaning", () => {
  for (const [percentUsed, expected] of [[100, "0%"], [0, "100%"], [33.7, "66%"], [140, "0%"], [-10, "100%"]]) {
    assert.equal(accountQuotaRemaining({ usage: { percentUsed } }).text, expected);
  }
  assert.equal(accountQuotaRemaining({ usage: { remaining: 330, entitlement: 1000 } }).text, "33%");
  assert.equal(accountQuotaRemaining({ usage: { remaining: 0 } }).text, "0");
  assert.equal(accountQuotaRemaining({ usage: { remaining: 27 } }).text, "27");
});
