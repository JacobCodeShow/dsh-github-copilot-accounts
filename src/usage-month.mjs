// UTC calendar helper for current usage display. No history, prediction or I/O.
const DAY = 86_400_000;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
function time(value) {
  if (value instanceof Date) value = value.getTime();
  if (finite(value)) return Number.isSafeInteger(value) && Math.abs(value) <= 8.64e15 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return undefined;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = parts;
  const year = Number(yearRaw), month = Number(monthRaw), date = Number(dayRaw);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!days || date < 1 || date > days || Number(hourRaw) > 23 || Number(minuteRaw) > 59 || Number(secondRaw) > 59) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
export function utcMonthProgress(now = Date.now()) {
  const at = time(now);
  if (at === undefined) throw new TypeError("Usage month requires a valid timestamp");
  const date = new Date(at), year = date.getUTCFullYear(), month = date.getUTCMonth();
  const beginning = new Date(0), ending = new Date(0);
  beginning.setUTCFullYear(year, month, 1); ending.setUTCFullYear(year, month + 1, 1);
  beginning.setUTCHours(0, 0, 0, 0); ending.setUTCHours(0, 0, 0, 0);
  const start = beginning.getTime(), end = ending.getTime();
  if (!finite(start) || !finite(end) || end <= start) throw new TypeError("Usage month is outside the supported range");
  const totalDays = (end - start) / DAY, elapsedDays = (at - start) / DAY;
  return { key: `${year}-${String(month + 1).padStart(2, "0")}`, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    totalDays, dayIndex: date.getUTCDate(), completedDays: Math.floor(elapsedDays), daysAfterToday: totalDays - date.getUTCDate(),
    elapsedDays, remainingDays: (end - at) / DAY, elapsedPercent: elapsedDays / totalDays * 100 };
}
