import { test } from "node:test";
import assert from "node:assert/strict";
import { utcMonthProgress } from "../src/usage-month.mjs";

test("UTC month progress exposes exact day and remaining-day boundaries", () => {
  const month = utcMonthProgress("2026-11-11T12:00:00.000Z");
  assert.deepEqual(month, { key: "2026-11", start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z",
    totalDays: 30, dayIndex: 11, completedDays: 10, daysAfterToday: 19, elapsedDays: 10.5, remainingDays: 19.5, elapsedPercent: 35 });
});
test("UTC conversion covers leap years, year rollover and timezone offsets", () => {
  assert.equal(utcMonthProgress("2024-02-29T12:00:00Z").totalDays, 29);
  assert.equal(utcMonthProgress("2026-12-31T23:59:59Z").remainingDays > 0, true);
  assert.equal(utcMonthProgress("2026-11-01T00:30:00+01:00").key, "2026-10");
});
test("invalid dates and nonfinite timestamps fail instead of guessing a calendar", () => {
  for (const value of ["2026-02-30T00:00:00Z", "2026-11-11", "not-a-date", Infinity, NaN]) assert.throws(() => utcMonthProgress(value));
});
