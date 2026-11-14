// Browser-only state/transport for the Session badge. No localhost REST or
// global Session/Host lookup; every operation belongs to one retained binding.
import { createSessionAccountClient, SessionAccountClientError } from "./session-client.mjs";
import { avatarImageCache } from "./avatar-cache-scope.mjs";

const ACCOUNT_ROUTE = /^copilot-account-[a-f0-9]{64}$/;
const selection = (value) => typeof value?.provider === "string" && typeof value?.model === "string" ? ({
  provider: value.provider, model: value.model,
  ...(typeof value.reasoningEffort === "string" ? { reasoningEffort: value.reasoningEffort } : {}),
}) : undefined;
export const accountLabel = (account, fallback = "Recovered account") => `${account.domain}/${account.login ?? account.name ?? fallback}`;
// Compact per-row balance; do not borrow the selected/global account's quota.
export function accountQuotaRemaining(account) {
  const usage = account?.usage;
  if (account?.available === false || account?.usageError !== undefined || !usage || typeof usage !== "object") return { text: "—", kind: "unknown" };
  if (usage.unlimited === true) return { text: "∞", kind: "unlimited" };
  const percent = Number.isFinite(usage.percentUsed) ? 100 - usage.percentUsed
    : Number.isFinite(usage.remaining) && Number.isFinite(usage.entitlement) && usage.entitlement > 0
      ? 100 * usage.remaining / usage.entitlement : null;
  if (percent !== null) {
    const remaining = Math.round(Math.max(0, Math.min(100, percent)));
    return { text: `${remaining}%`, kind: "percent", remaining };
  }
  if (Number.isFinite(usage.remaining)) return { text: String(Math.max(0, usage.remaining)), kind: "count" };
  return { text: "—", kind: "unknown" };
}
// Display-only account-percent sum, NOT a weighted AI-credit/billing pool.
export function combinedAccountUsage(accounts) {
  const unique = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (typeof account?.id === "string" && account.id !== "" && !unique.has(account.id)) unique.set(account.id, account);
  }
  let used = 0, unknown = 0, unlimited = 0;
  for (const account of unique.values()) {
    const quota = accountQuotaRemaining(account);
    if (quota.kind === "unlimited") { unlimited++; continue; }
    if (quota.kind !== "percent") { unknown++; continue; }
    const usage = account.usage;
    const percentUsed = Number.isFinite(usage.percentUsed) ? usage.percentUsed : 100 * (1 - usage.remaining / usage.entitlement);
    used += Math.max(0, Math.min(100, percentUsed));
  }
  const count = unique.size;
  return { visible: count > 1, count, used: unknown === 0 && unlimited === 0 ? Math.round(used) : null,
    capacity: unlimited > 0 ? null : count * 100, unknown, unlimited };
}
export function deriveSessionBadgeState(catalog, { busy = false, running = false } = {}) {
  const accounts = Array.isArray(catalog?.accounts) ? catalog.accounts : [];
  const next = catalog?.next;
  const expected = selection(next);
  const mode = next?.mode === "global" && (expected?.provider === "github-copilot" || expected?.provider === "copilot-default") ? "global"
    : next?.mode === "bound" && ACCOUNT_ROUTE.test(expected?.provider ?? "") ? "bound" : "inactive";
  const globals = accounts.filter((account) => account.globalActive === true || account.active === true);
  const globalAccount = globals.length === 1 ? globals[0] : null;
  const bound = mode === "bound" ? accounts.find((account) => account.id === next.accountId
    && (account.routeId === undefined || account.routeId === expected.provider)) : undefined;
  const unmanaged = mode === "global" && expected.provider === "github-copilot";
  const unavailable = mode === "bound" && (next.available !== true || bound === undefined || bound.available === false || bound.routeAvailable === false)
    || mode === "global" && globalAccount?.available === false;
  const account = unavailable || unmanaged ? null : mode === "bound" ? bound : mode === "global" ? globalAccount : null;
  const used = account?.usageError === undefined && Number.isFinite(account?.usage?.percentUsed)
    ? Math.max(0, Math.min(100, account.usage.percentUsed)) : null;
  return {
    mode, accounts, account, globalAccountId: globalAccount?.id ?? null,
    selectedAccountId: mode === "bound" ? next.accountId : null,
    followsGlobal: mode === "global" && !unmanaged, unavailable, unmanaged,
    running: running || catalog?.running === true,
    canBind: !busy && !running && catalog?.running !== true && mode !== "inactive" && expected !== undefined,
    canSetDefault: !busy,
    expected,
    used, remaining: used === null ? null : Math.round(100 - used),
    unlimited: account?.usageError === undefined && account?.usage?.unlimited === true,
    plan: account?.plan, resets: account?.usage?.resets,
    usageUnavailable: account?.usageError !== undefined,
  };
}

export function matchingSessionFailureNotice(catalog, notice) {
  const view = deriveSessionBadgeState(catalog);
  if (notice?.code !== "ACCOUNT_REQUEST_FAILED" || notice.sessionId !== catalog?.sessionId || typeof notice.id !== "string"
    || notice.accountId !== view.account?.id || notice.logicalProvider !== catalog?.next?.provider
    || notice.model !== undefined && notice.model !== catalog?.next?.model) return null;
  return { id: notice.id, sessionId: notice.sessionId, code: "ACCOUNT_REQUEST_FAILED", accountId: notice.accountId,
    logicalProvider: notice.logicalProvider, ...(notice.model === undefined ? {} : { model: notice.model }) };
}

const safeCode = (error) => {
  try { return typeof error?.code === "string" && Object.hasOwn(SESSION_BADGE_ERROR_KEYS, error.code) ? error.code : "INTERNAL_ERROR"; }
  catch { return "INTERNAL_ERROR"; }
};
const stale = () => new SessionAccountClientError("STALE_SESSION");
const unavailableProfile = () => Promise.reject(stale());

// Factory is created inside a React effect, not memoized across StrictMode
// cleanup/remount. Testable independently of React and real network transports.
export function createSessionBadgeController({ sessionId, sessions, clientFactory = createSessionAccountClient, imageCache = avatarImageCache }) {
  if (typeof sessionId !== "string" || typeof sessions?.binding !== "function" || typeof sessions?.scope !== "function") throw new TypeError("Session badge requires retained Session services");
  let closed = false, transport, readSequence = 0, mutationSequence = 0, pendingRead;
  let snapshot = { status: "loading", catalog: null, errorCode: null, busy: false, running: false, failureNotice: null,
    scopeKey: {}, requestProfile: unavailableProfile, isCurrent: () => false };
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) { try { listener(); } catch { /* observers cannot undo state */ } } };
  const publish = (next) => { if (!closed) { snapshot = { ...snapshot, ...next }; notify(); } };
  const current = (value) => {
    try { return !closed && transport === value && sessions.binding(sessionId) === value.binding
      && sessions.scope(sessionId) === value.scope && value.connection.generation.getSnapshot() === value.generation; }
    catch { return false; }
  };
  const retire = () => {
    readSequence++; mutationSequence++; pendingRead = undefined;
    if (transport !== undefined) {
      const previous = transport; transport = undefined;
      if (previous.scopeKey !== undefined) imageCache.disposeScope(previous.scopeKey);
      for (const dispose of previous.cleanups) { try { dispose(); } catch { /* best effort */ } }
      previous.client?.dispose?.();
    }
  };
  const resolve = () => {
    if (closed) return undefined;
    let binding, scope, connection, generation;
    try {
      binding = sessions.binding(sessionId); scope = sessions.scope(sessionId);
      connection = scope?.get("connection"); generation = connection?.generation?.getSnapshot();
    } catch { /* unsupported or ended scope fails closed */ }
    if (binding === undefined || scope === undefined || typeof connection?.rpc?.call !== "function"
      || typeof connection?.generation?.subscribe !== "function" || typeof connection?.generation?.getSnapshot !== "function") {
      retire(); publish({ status: "unavailable", catalog: null, errorCode: "STALE_SESSION", busy: false,
        running: false, failureNotice: null, scopeKey: {}, requestProfile: unavailableProfile, isCurrent: () => false });
      return undefined;
    }
    if (transport?.binding === binding && transport.scope === scope && transport.store === connection.generation
      && transport.generation === generation) return transport;
    retire();
    const value = { binding, scope, connection, store: connection.generation, generation, cleanups: [], profileRequests: new Map(),
      seenNotices: new Set(), noticeSeeded: false, pendingFailure: false, avatarAccounts: new Map() };
    transport = value;
    value.client = clientFactory({ sessionId, connection, isCurrent: () => current(value) });
    value.scopeKey = {}; // opaque per-binding/connection-generation identity
    value.requestProfile = (id) => {
      if (!current(value)) return Promise.reject(stale());
      if (value.profileRequests.has(id)) return value.profileRequests.get(id);
      const request = value.client.profile({ accountId: id }).then((result) => {
        if (!current(value)) throw stale();
        return result.avatarUrl;
      }).finally(() => { if (value.profileRequests.get(id) === request) value.profileRequests.delete(id); });
      value.profileRequests.set(id, request);
      return request;
    };
    try {
      const remote = scope.get("remote");
      if (typeof remote?.$on === "function") value.cleanups.push(remote.$on("api-session/error", (failedSessionId) => {
        // Deliberately ignore the raw failure text. Only this Host/Session's
        // current safe catalog notice may open a popup after a fresh read.
        if (failedSessionId !== sessionId || !current(value)) return;
        value.pendingFailure = true;
        void refresh(true);
      }));
    } catch { /* headless/test scopes may not carry the GUI event service */ }
    const running = binding.session?.getSnapshot?.().running === true;
    publish({ status: "loading", catalog: null, errorCode: null, busy: false, running, failureNotice: null,
      scopeKey: value.scopeKey, requestProfile: value.requestProfile, isCurrent: () => current(value) });
    value.cleanups.push(connection.generation.subscribe(() => { if (transport === value) void refresh(true); }));
    if (typeof binding.session?.subscribe === "function") value.cleanups.push(binding.session.subscribe(() => {
      if (!current(value)) { void refresh(true); return; }
      const nextRunning = binding.session.getSnapshot().running === true;
      if (nextRunning !== snapshot.running) publish({ running: nextRunning });
    }));
    const projected = binding.session?.projections?.faceOf?.("modelSelection");
    if (typeof projected?.subscribe === "function") value.cleanups.push(projected.subscribe(() => {
      if (transport !== value) return;
      value.pendingFailure = false; value.noticeSeeded = false;
      publish({ status: "loading", catalog: null, failureNotice: null }); // never retain another selected account's credits
      void refresh(true);
    }));
    return value;
  };
  const refresh = (invalidate = false) => {
    let value;
    try { value = resolve(); } catch (error) {
      retire(); publish({ status: "unavailable", catalog: null, failureNotice: null, busy: false, errorCode: safeCode(error), requestProfile: unavailableProfile });
      return Promise.resolve(undefined);
    }
    if (value === undefined) return Promise.resolve(undefined);
    if (!invalidate && pendingRead?.transport === value) return pendingRead.promise;
    const sequence = ++readSequence;
    const promise = value.client.catalog().then((catalog) => {
      if (!current(value) || sequence !== readSequence) return undefined;
      if (catalog.sessionId !== sessionId) throw stale();
      const accounts = new Map((Array.isArray(catalog.accounts) ? catalog.accounts : [])
        .filter((account) => typeof account.id === "string" && typeof account.domain === "string" && account.available !== false)
        .map((account) => [account.id, account.domain]));
      for (const [id, issuer] of value.avatarAccounts) if (accounts.get(id) !== issuer) imageCache.invalidateAccount(value.scopeKey, issuer, id);
      value.avatarAccounts = accounts;
      publish({ status: "ready", catalog, errorCode: null, failureNotice: matchingSessionFailureNotice(catalog, snapshot.failureNotice),
        running: value.binding.session?.getSnapshot?.().running === true || catalog.running === true });
      const notice = matchingSessionFailureNotice(catalog, catalog.notice);
      if (notice === null && typeof catalog.notice?.id === "string") value.seenNotices.add(catalog.notice.id);
      if (!value.noticeSeeded) {
        value.noticeSeeded = true;
        if (!value.pendingFailure && notice !== null) value.seenNotices.add(notice.id);
      }
      if (value.pendingFailure) {
        value.pendingFailure = false;
        if (notice !== null && !value.seenNotices.has(notice.id)) {
          value.seenNotices.add(notice.id);
          while (value.seenNotices.size > 32) value.seenNotices.delete(value.seenNotices.values().next().value);
          publish({ failureNotice: notice });
        }
      }
      return catalog;
    }).catch((error) => {
      if (current(value) && sequence === readSequence) {
        value.pendingFailure = false;
        publish({ status: "unavailable", catalog: null, failureNotice: null, errorCode: safeCode(error) });
      }
      return undefined;
    }).finally(() => { if (pendingRead?.promise === promise) pendingRead = undefined; });
    pendingRead = { transport: value, promise };
    return promise;
  };
  const mutate = async (method, accountId) => {
    const value = transport;
    if (value === undefined || !current(value) || snapshot.status !== "ready" || snapshot.busy) return false;
    const view = deriveSessionBadgeState(snapshot.catalog, { busy: snapshot.busy, running: snapshot.running });
    if (method === "bind" && !view.canBind) return false;
    if (accountId !== null) {
      const target = view.accounts.find((account) => account.id === accountId);
      if (target === undefined || target.available === false || method === "bind" && target.routeAvailable === false) return false;
    }
    const sequence = ++mutationSequence;
    value.pendingFailure = false;
    publish({ busy: true, errorCode: null, failureNotice: null });
    try {
      await value.client[method]({ accountId, ...(method === "bind" ? { expected: view.expected } : {}) });
      if (!current(value) || sequence !== mutationSequence) return false;
      // Explicit follow-up read, never a repeated mutation.
      await refresh(true);
      return current(value) && sequence === mutationSequence;
    } catch (error) {
      if (current(value) && sequence === mutationSequence) publish({ status: "unavailable", catalog: null, errorCode: safeCode(error) });
      return false;
    } finally {
      if (current(value) && sequence === mutationSequence) publish({ busy: false });
    }
  };
  let listCleanup;
  if (typeof sessions.list?.subscribe === "function") listCleanup = sessions.list.subscribe(() => {
    if (!closed && (transport === undefined || sessions.binding(sessionId) !== transport.binding || sessions.scope(sessionId) !== transport.scope)) void refresh(true);
  });
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
    dismissFailure() { if (transport !== undefined) transport.pendingFailure = false; publish({ failureNotice: null }); },
    bind(accountId) { return mutate("bind", accountId); },
    setDefault(accountId) { return mutate("setDefault", accountId); },
    dispose() { if (!closed) { closed = true; retire(); listCleanup?.(); listeners.clear(); } },
  });
}

export const SESSION_BADGE_ERROR_KEYS = Object.freeze({
  OWNER_REQUIRED: "badgeErrorOwner", SESSION_FORBIDDEN: "badgeErrorForbidden",
  SESSION_BUSY: "badgeErrorBusy", NOT_COPILOT_SESSION: "badgeErrorInactive",
  STALE_SELECTION: "badgeErrorStale", STALE_SESSION: "badgeErrorStale",
  ACCOUNT_UNAVAILABLE: "badgeErrorAccount", ACCOUNT_MODEL_UNAVAILABLE: "badgeErrorModel",
  ACCOUNT_COMPACTION_RESTART_REQUIRED: "badgeErrorRestart",
  POLICY_UNAVAILABLE: "badgeErrorUnavailable", SESSION_UNAVAILABLE: "badgeErrorUnavailable",
  TRANSPORT_UNAVAILABLE: "badgeErrorUnavailable", REQUEST_CANCELLED: "badgeErrorCancelled",
  INVALID_ARGUMENT: "badgeErrorRequest", SELECTION_FAILED: "badgeErrorRequest",
  ACCOUNT_PROFILE_FAILED: "badgeErrorRequest", DEFAULT_ACCOUNT_FAILED: "badgeErrorRequest",
  INTERNAL_ERROR: "badgeErrorRequest",
});
export const sessionBadgeErrorKey = (code) => typeof code === "string" && Object.hasOwn(SESSION_BADGE_ERROR_KEYS, code) ? SESSION_BADGE_ERROR_KEYS[code] : "badgeErrorRequest";
