// Current-snapshot presentation only. No history, requests or billing inference.
const DAY = 86_400_000;
export function utcMonthProgress(now = Date.now()) {
  const at = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(at)) throw new TypeError("Invalid UTC month timestamp");
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid UTC month timestamp");
  const start = new Date(0), end = new Date(0), year = date.getUTCFullYear(), month = date.getUTCMonth();
  start.setUTCFullYear(year, month, 1); end.setUTCFullYear(year, month + 1, 1);
  start.setUTCHours(0, 0, 0, 0); end.setUTCHours(0, 0, 0, 0);
  const first = start.getTime(), last = end.getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) throw new TypeError("Invalid UTC month bounds");
  return { key: `${year}-${String(month + 1).padStart(2, "0")}`, start: first, end: last,
    totalDays: (last - first) / DAY, elapsedDays: (at - first) / DAY, remainingDays: (last - at) / DAY,
    elapsedPercent: (at - first) / (last - first) * 100 };
}

export function combinedAccountUsage(accounts) {
  const unique = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (typeof account?.id === "string" && account.id !== "" && !unique.has(account.id)) unique.set(account.id, account);
  }
  let sum = 0, unknown = 0, unlimited = 0;
  for (const account of unique.values()) {
    if (account.available === false || account.usageError !== undefined) { unknown++; continue; }
    const usage = account.usage;
    if (usage?.unlimited === true) { unlimited++; continue; }
    if (!Number.isFinite(usage?.percentUsed) || usage.percentUsed < 0) { unknown++; continue; }
    sum += usage.percentUsed; // Round once, and do not hide genuine over-limit use.
  }
  const count = unique.size;
  return { visible: count > 1, count, used: unknown || unlimited || !Number.isFinite(sum) ? null : Math.round(sum),
    capacity: unlimited ? null : count * 100, unknown, unlimited };
}

export const validUsedPercent = (usage) => usage?.unlimited !== true && Number.isFinite(usage?.percentUsed) && usage.percentUsed >= 0
  ? usage.percentUsed : null;
