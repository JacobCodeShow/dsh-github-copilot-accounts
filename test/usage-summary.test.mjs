import { test } from "node:test";
import assert from "node:assert/strict";
import { utcMonthProgress, combinedAccountUsage, validUsedPercent } from "../src/usage-summary.mjs";
const row = (id, percentUsed, extra = {}) => ({ id, usage: { percentUsed }, ...extra });

test("UTC month fraction and day totals share exact boundaries", () => {
  const month = utcMonthProgress(Date.UTC(2026, 10, 11, 12));
  assert.deepEqual(month, { key: "2026-11", start: Date.UTC(2026, 10, 1), end: Date.UTC(2026, 11, 1),
    totalDays: 30, elapsedDays: 10.5, remainingDays: 19.5, elapsedPercent: 35 });
  assert.equal(utcMonthProgress(new Date("2024-02-29T12:00:00Z")).totalDays, 29);
  assert.equal(utcMonthProgress(Date.parse("2026-11-01T00:30:00+01:00")).key, "2026-10");
  assert.equal(utcMonthProgress(Date.UTC(2026, 11, 1)).elapsedPercent, 0);
  assert.equal(utcMonthProgress(Date.UTC(2026, 11, 31, 23, 59, 59)).end, Date.UTC(2027, 0, 1));
});
test("invalid clocks cannot manufacture a date cursor", () => {
  for (const at of [NaN, Infinity, -Infinity, "2026-11-11", null, new Date("invalid"), 9e15]) assert.throws(() => utcMonthProgress(at));
});
test("combined current percentages are summed before rounding, not averaged or credit weighted", () => {
  assert.deepEqual(combinedAccountUsage([row("a", 10), row("b", 5), row("c", 6), row("d", 4)]),
    { visible: true, count: 4, used: 25, capacity: 400, unknown: 0, unlimited: 0 });
  assert.equal(combinedAccountUsage([row("a", 0.4), row("b", 0.4), row("c", 0.4)]).used, 1);
  assert.equal(combinedAccountUsage([row("a", 120), row("b", 20)]).used, 140);
  assert.equal(combinedAccountUsage([row("a", 0), row("b", 0)]).used, 0);
});
test("zero or one unique account hides combined display and duplicate ids never add capacity", () => {
  for (const rows of [undefined, [], [row("a", 25)], [row("a", 25), row("a", 90)]]) assert.equal(combinedAccountUsage(rows).visible, false);
  assert.deepEqual(combinedAccountUsage([row("a", 10), row("a", 90), row("b", 5), row("", 99), {}]),
    { visible: true, count: 2, used: 15, capacity: 200, unknown: 0, unlimited: 0 });
});
test("unknown, failed and malformed percentages are not zero-used accounts", () => {
  for (const bad of [row("b", NaN), row("b", Infinity), row("b", -1), row("b", "10"), {id:"b"},
    row("b", 5, {usageError:"unavailable"}), row("b", 5, {available:false})]) {
    const combined = combinedAccountUsage([row("a", 10), bad]);
    assert.equal(combined.used, null); assert.equal(combined.capacity, 200); assert.equal(combined.unknown, 1);
  }
  assert.equal(combinedAccountUsage([row("a", Number.MAX_VALUE), row("b", Number.MAX_VALUE)]).used, null);
});
test("unlimited accounts have no finite normalized capacity or invented used percentage", () => {
  const unlimited = row("b", 100, {usage:{unlimited:true,percentUsed:100}});
  assert.deepEqual(combinedAccountUsage([row("a", 20), unlimited]), {visible:true,count:2,used:null,capacity:null,unknown:0,unlimited:1});
  assert.equal(validUsedPercent(unlimited.usage), null);
});
test("settings individual percentage validation preserves legitimate over-limit use", () => {
  for (const value of [0, 25, 80, 100, 123.4]) assert.equal(validUsedPercent({percentUsed:value}), value);
  for (const value of [undefined, null, NaN, Infinity, "25", -1]) assert.equal(validUsedPercent({percentUsed:value}), null);
  assert.equal(validUsedPercent(), null);
});
