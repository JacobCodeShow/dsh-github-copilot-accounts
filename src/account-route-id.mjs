// Host-only route identity. Stable slot keys, not display names or credentials,
// determine the public route persisted in Session model/selection records.
import { createHash } from "node:crypto";

export const ACCOUNT_ROUTE_PREFIX = "copilot-account-";
export const GLOBAL_COPILOT_ROUTE = "copilot-default";
const ACCOUNT_ROUTE = /^copilot-account-[a-f0-9]{64}$/;

export function accountRouteId(accountId) {
  if (typeof accountId !== "string" || !/^copilot-auth\/account-[a-z0-9-]+$/.test(accountId)) {
    throw new TypeError("Invalid Copilot account slot id");
  }
  return `${ACCOUNT_ROUTE_PREFIX}${createHash("sha256").update(accountId, "utf8").digest("hex")}`;
}

export const isAccountRoute = (provider) => typeof provider === "string" && ACCOUNT_ROUTE.test(provider);
export const isManagedCopilotRoute = (provider) => provider === GLOBAL_COPILOT_ROUTE || isAccountRoute(provider);

// Normalize legacy/explicit alias fallbacks on reads. The policy facade ignores
// bound-route saves entirely: neither its model nor account becomes a future
// default. This helper never writes config or changes the Session's own route.
export function normalizeDefaultSelection(selection) {
  return { ...selection, ...(isManagedCopilotRoute(selection.provider) ? { provider: "github-copilot" } : {}) };
}
