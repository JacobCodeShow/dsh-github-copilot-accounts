import { accountRouteId } from "./account-route-id.mjs";
import { normalizeDomain } from "./shared.mjs";

export class AccountRegistryError extends Error {
  constructor(message, code = "ACCOUNT_REGISTRY") { super(message); this.name = "AccountRegistryError"; this.code = code; }
}
function descriptor(slot) {
  const account = slot.payload?.account ?? {};
  const domain = normalizeDomain(slot.payload?.enterpriseUrl) ?? normalizeDomain(account.domain) ?? "github.com";
  const login = typeof account.login === "string" ? account.login : undefined;
  return { id: slot.key, routeId: accountRouteId(slot.key), domain, login,
    name: typeof account.name === "string" ? account.name : undefined,
    avatarUrl: typeof account.avatarUrl === "string" ? account.avatarUrl : undefined,
    label: `${domain}/${login ?? "Recovered account"}` };
}
const modelKey = (slot) => slot.payload?.availableModelIds === undefined ? "native"
  : Array.isArray(slot.payload.availableModelIds) && slot.payload.availableModelIds.every((id) => typeof id === "string")
    ? JSON.stringify([...new Set(slot.payload.availableModelIds)].sort()) : "invalid";
const detachProfile = (profile) => {
  try { return structuredClone(profile); }
  catch { throw new AccountRegistryError("Account profile is unavailable", "ACCOUNT_PROFILE_INVALID"); }
};

// Own stable public routes. Never retain grants or swap shared-main credentials.
// Config generations replace delegates through a stable proxy, not route deletion.
export function createAccountRegistry({ llm, listSlots, createAdapter, adapterOptions = {}, emitModelsUpdated = () => {} }) {
  if (typeof llm?.registerAdapter !== "function" || typeof listSlots !== "function" || typeof createAdapter !== "function") {
    throw new TypeError("Account registry requires LLM registration, live slots and an adapter factory");
  }
  const entries = new Map(), routes = new Map(), tombstones = new Set();
  let closed = false, tail = Promise.resolve(), profileRevision = 0;
  let currentProfile = detachProfile(adapterOptions.profile);
  const requireOpen = () => { if (closed) throw new AccountRegistryError("Account registry is disposed", "REGISTRY_DISPOSED"); };
  const notify = (routeId) => {
    try { void Promise.resolve(emitModelsUpdated(routeId)).catch(() => {}); } catch { /* observer cannot veto topology */ }
  };
  const cleanAdapter = (adapter) => {
    try { void Promise.resolve(adapter?.dispose?.()).catch(() => {}); } catch { /* dispose other routes too */ }
  };
  const withdraw = (entry) => {
    entry.enabled = false; // Revoke BEFORE unregistering or waiting for cleanup.
    cleanAdapter(entry.adapter);
    entry.registration?.();
  };
  const row = (entry) => ({ ...entry.metadata, available: true, routeAvailable: entry.adapter.profileError === undefined });
  const enqueue = (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  const reconcile = () => enqueue(async () => {
    requireOpen();
    const slots = await listSlots();
    requireOpen();
    const desired = new Map(), versions = new Map();
    for (const slot of slots) {
      if (tombstones.has(slot.key)) continue;
      if (desired.has(slot.key)) throw new AccountRegistryError("Duplicate account slot", "DUPLICATE_ACCOUNT");
      desired.set(slot.key, descriptor(slot)); versions.set(slot.key, modelKey(slot));
    }
    const additions = [];
    try {
      for (const [id, metadata] of desired) {
        if (entries.has(id) || tombstones.has(id)) continue;
        let builtRevision = profileRevision;
        const entry = { metadata, enabled: true, adapter: undefined, registration: undefined, announced: false };
        additions.push(entry);
        entry.adapter = await createAdapter({
          ...adapterOptions, profile: detachProfile(currentProfile), accountId: id, routeId: metadata.routeId,
          displayName: () => `GitHub Copilot — ${entry.metadata.label}`,
          isEnabled: () => !closed && entry.enabled && !tombstones.has(id)
            && (adapterOptions.isEnabled === undefined ? true : adapterOptions.isEnabled(id)),
          onPublish: () => {
            requireOpen();
            if (!entry.enabled || tombstones.has(id)) throw new AccountRegistryError("Account is unavailable", "ACCOUNT_UNAVAILABLE");
            entry.registration?.replace?.([metadata.routeId]);
            notify(metadata.routeId);
          },
        });
        requireOpen();
        // A settings update may race an initial async compile before publication.
        while (builtRevision !== profileRevision) {
          builtRevision = profileRevision;
          if (typeof entry.adapter.updateProfile !== "function") throw new AccountRegistryError("Account profile updates are unsupported", "ACCOUNT_PROFILE_INVALID");
          await entry.adapter.updateProfile(detachProfile(currentProfile));
          requireOpen();
        }
      }
      for (const entry of additions) {
        if (tombstones.has(entry.metadata.id)) { entry.enabled = false; continue; }
        entry.registration = llm.registerAdapter([entry.metadata.routeId], entry.adapter);
      }
      requireOpen();
    } catch (error) {
      for (const entry of additions) { entry.enabled = false; cleanAdapter(entry.adapter); try { entry.registration?.(); } catch { /* rollback owned routes */ } }
      throw error;
    }
    for (const entry of additions) {
      if (!entry.enabled || tombstones.has(entry.metadata.id)) { cleanAdapter(entry.adapter); try { entry.registration?.(); } catch { /* reentrant withdrawal */ } continue; }
      entries.set(entry.metadata.id, entry); routes.set(entry.metadata.routeId, entry);
    }
    for (const [id, entry] of entries) {
      const next = desired.get(id);
      if (next === undefined || tombstones.has(id)) {
        entries.delete(id); routes.delete(entry.metadata.routeId); withdraw(entry); continue;
      }
      const renamed = next.label !== entry.metadata.label;
      const modelsChanged = entry.modelsKey !== versions.get(id);
      entry.metadata = next; entry.modelsKey = versions.get(id);
      if (renamed) entry.registration?.replace?.([next.routeId]);
      if (!entry.announced || renamed || modelsChanged) notify(next.routeId);
      entry.announced = true;
    }
    return [...entries.values()].map(row);
  });
  return {
    reconcile,
    accounts: () => [...entries.values()].map(row),
    account(id) { const entry = entries.get(id); return entry?.enabled ? row(entry) : undefined; },
    // Host-only delegation; never included in public account DTOs.
    delegateForAccount(id) { const entry = entries.get(id); return entry?.enabled ? entry.adapter : undefined; },
    accountForRoute(routeId) { const entry = routes.get(routeId); return entry?.enabled ? row(entry) : undefined; },
    async updateProfile(profile) {
      requireOpen();
      currentProfile = detachProfile(profile); profileRevision++;
      const results = await Promise.allSettled([...entries.values()].map(async (entry) => {
        if (typeof entry.adapter.updateProfile !== "function") throw new AccountRegistryError("Account profile updates are unsupported", "ACCOUNT_PROFILE_INVALID");
        return entry.adapter.updateProfile(detachProfile(currentProfile));
      }));
      requireOpen();
      if (results.some((result) => result.status === "rejected")) throw new AccountRegistryError("Account profile update failed", "ACCOUNT_PROFILE_INVALID");
      return results.map((result) => result.value);
    },
    remove(id) {
      requireOpen(); accountRouteId(id); tombstones.add(id);
      const entry = entries.get(id);
      if (entry !== undefined) { entries.delete(id); routes.delete(entry.metadata.routeId); withdraw(entry); }
    },
    reactivate(id) { requireOpen(); accountRouteId(id); tombstones.delete(id); return reconcile(); },
    dispose() {
      if (closed) return;
      closed = true;
      for (const entry of entries.values()) { try { withdraw(entry); } catch { /* withdraw every account */ } }
      entries.clear(); routes.clear();
    },
  };
}
