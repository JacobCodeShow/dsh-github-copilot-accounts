// Host-only native Remote bridge. Never routes a remote Session through a local
// REST endpoint or captures the constructor's owner principal for later calls.
import { AsyncLocalStorage } from "node:async_hooks";
import { GLOBAL_COPILOT_ROUTE, isAccountRoute, accountRouteId } from "./account-route-id.mjs";

export const SESSION_ACCOUNTS_NAMESPACE = "copilotAccounts";
const SAFE_ERRORS = Object.freeze({
  INVALID_ARGUMENT: [400, "Invalid Session account request"],
  OWNER_REQUIRED: [403, "Only the Host owner may manage Copilot accounts"],
  SESSION_FORBIDDEN: [403, "Session access denied"],
  SESSION_UNAVAILABLE: [404, "Session is unavailable"],
  POLICY_UNAVAILABLE: [503, "Session account policy is unavailable"],
  SESSION_BUSY: [409, "Wait for the Session to become idle before changing account"],
  SIGN_IN_PROGRESS: [409, "Finish or cancel account sign-in before changing the global default"],
  NOT_COPILOT_SESSION: [409, "Select a Copilot model before binding an account"],
  STALE_SELECTION: [409, "Session model changed; reload account choices"],
  ACCOUNT_UNAVAILABLE: [404, "Selected account is unavailable"],
  ACCOUNT_MODEL_UNAVAILABLE: [409, "Selected account does not support the current model controls"],
  ACCOUNT_COMPACTION_RESTART_REQUIRED: [409, "Restart DSH to apply compaction policy for this account"],
  ACCOUNT_PROFILE_INVALID: [409, "Copilot account model settings are unavailable"],
  ACCOUNT_PROFILE_UNSUPPORTED: [409, "Copilot account routes require native protocol and endpoint settings"],
  ACCOUNT_RUNTIME_UNAVAILABLE: [503, "Session account runtime is unavailable"],
  SELECTION_FAILED: [502, "Session account selection failed"],
  ACCOUNT_PROFILE_FAILED: [502, "Account profile refresh failed"],
  DEFAULT_ACCOUNT_FAILED: [502, "Global default account update failed"],
  REQUEST_CANCELLED: [499, "Session account request was cancelled"],
  INTERNAL_ERROR: [500, "Session account operation failed"],
});
const fail = (code) => Object.assign(new Error(code), { code });
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const accountId = (id) => typeof id === "string" && id.length <= 2048 && /^copilot-auth\/account-[a-z0-9-]+$/.test(id);
const text = (value) => typeof value === "string";
const put = (output, source, key, valid = text) => { if (valid(source?.[key])) output[key] = source[key]; };

function requestOf(method, request) {
  if (!plain(request) || typeof request.sessionId !== "string" || request.sessionId.length === 0 || request.sessionId.length > 256) throw fail("INVALID_ARGUMENT");
  const clean = { sessionId: request.sessionId };
  if (method !== "catalog") {
    if (!(method === "bind" && request.accountId === null) && !accountId(request.accountId)) throw fail("INVALID_ARGUMENT");
    clean.accountId = request.accountId;
  }
  if (method === "bind" && request.expected !== undefined) {
    if (!plain(request.expected) || !text(request.expected.provider) || !text(request.expected.model)
      || request.expected.reasoningEffort !== undefined && !text(request.expected.reasoningEffort)) throw fail("INVALID_ARGUMENT");
    clean.expected = selectionOf(request.expected);
  }
  return clean;
}
function selectionOf(value) {
  if (!plain(value) || !text(value.provider) || !text(value.model)) throw fail("INTERNAL_ERROR");
  const selected = { provider: value.provider, model: value.model };
  put(selected, value, "reasoningEffort");
  return selected;
}
function publicAccount(value) {
  if (!plain(value) || !accountId(value.id)) throw fail("INTERNAL_ERROR");
  const row = { id: value.id };
  for (const key of ["routeId", "domain", "login", "name", "avatarUrl", "label", "plan"]) put(row, value, key);
  for (const key of ["active", "globalActive", "available", "routeAvailable"]) put(row, value, key, (member) => typeof member === "boolean");
  if (plain(value.usage)) {
    row.usage = {};
    for (const key of ["percentUsed", "entitlement", "remaining"]) put(row.usage, value.usage, key, (member) => Number.isFinite(member) && !Object.is(member, -0));
    put(row.usage, value.usage, "unlimited", (member) => typeof member === "boolean");
    put(row.usage, value.usage, "resets");
  }
  if (value.usageError !== undefined) row.usageError = "Usage is unavailable";
  return row;
}
export function publicSessionFailureNotice(value, sessionId) {
  if (!plain(value) || value.code !== "ACCOUNT_REQUEST_FAILED" || value.sessionId !== sessionId
    || typeof value.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.id)
    || !accountId(value.accountId) || !(value.logicalProvider === GLOBAL_COPILOT_ROUTE || isAccountRoute(value.logicalProvider))) return null;
  if (isAccountRoute(value.logicalProvider) && value.logicalProvider !== accountRouteId(value.accountId)) return null;
  const notice = { id: value.id, sessionId, code: "ACCOUNT_REQUEST_FAILED", accountId: value.accountId, logicalProvider: value.logicalProvider };
  if (typeof value.model === "string" && value.model.length > 0 && value.model.length <= 4096) notice.model = value.model;
  for (const key of ["turn", "step"]) if (Number.isSafeInteger(value[key]) && value[key] >= 0 && !Object.is(value[key], -0)) notice[key] = value[key];
  return notice;
}
function routeOf(value) {
  if (!plain(value) || !["inactive", "global", "bound"].includes(value.mode)
    || value.accountId !== null && !accountId(value.accountId) || typeof value.available !== "boolean") throw fail("INTERNAL_ERROR");
  const route = { mode: value.mode, accountId: value.accountId, available: value.available };
  for (const key of ["provider", "model", "reasoningEffort"]) put(route, value, key);
  if (value.account !== undefined) route.account = publicAccount(value.account);
  return route;
}
function stateOf(value, sessionId) {
  if (!plain(value) || value.sessionId !== sessionId || typeof value.running !== "boolean") throw fail("INTERNAL_ERROR");
  return { sessionId, running: value.running, next: routeOf(value.next), lastUsed: routeOf(value.lastUsed) };
}

/**
 * Factory keeps runtime peer imports out of module load. createCoordinator is
 * called once with a mandatory per-invocation authorizeSession callback, so its
 * Session queues stay shared while principals never bleed across calls.
 */
export function createSessionRemoteService({ TypertRemoteService, Remote, RemoteError, principalOf, createCoordinator, handlers }) {
  if (typeof TypertRemoteService !== "function" || typeof Remote !== "function" || typeof RemoteError !== "function"
    || typeof principalOf !== "function" || typeof createCoordinator !== "function"
    || ["catalog", "profile", "setDefault"].some((method) => typeof handlers?.[method] !== "function")) {
    throw new TypeError("Session Remote requires runtime protocol, coordinator factory and handlers");
  }
  const initializers = [];
  const scope = new AsyncLocalStorage();
  const requireOwner = (ctx) => {
    const invocation = ctx?.invocation;
    // principalOf(undefined) is also undefined: outside-invocation is NOT owner.
    if (invocation?.peer?.principal?.kind !== "owner" || principalOf(invocation) !== undefined) throw fail("OWNER_REQUIRED");
    if (invocation.signal?.aborted === true || invocation.peer.signal?.aborted === true) throw fail("REQUEST_CANCELLED");
  };
  const authorizeSession = async (sessionId) => {
    const ctx = scope.getStore();
    try {
      requireOwner(ctx);
      return await ctx.remoteAccess.allows({ kind: "session", id: sessionId }) === true;
    } catch { return false; }
  };
  const safeError = (error) => {
    let code;
    try { code = error?.code; } catch { /* hostile/unknown diagnostics stay private */ }
    if (code === "REGISTRY_DISPOSED") code = "POLICY_UNAVAILABLE";
    if (code === "session/writer-held") code = "SESSION_BUSY";
    if (code === "session/subagent-owned") code = "SESSION_UNAVAILABLE";
    if (typeof code !== "string" || !Object.hasOwn(SAFE_ERRORS, code)) code = "INTERNAL_ERROR";
    const [status, message] = SAFE_ERRORS[code];
    return new RemoteError(code, message, { status });
  };
  class CopilotAccountsRemote extends TypertRemoteService {
    static inject = ["remoteAccess"];
    constructor(ctx) {
      super(ctx, SESSION_ACCOUNTS_NAMESPACE, { namespace: SESSION_ACCOUNTS_NAMESPACE });
      for (const initialize of initializers) initialize.call(this);
      this.coordinator = createCoordinator(authorizeSession);
      if (typeof this.coordinator?.read !== "function" || typeof this.coordinator?.bind !== "function") throw new TypeError("Session coordinator must expose read and bind");
    }
    catalog(request) { return this.invokeAccountOperation("catalog", request); }
    bind(request) { return this.invokeAccountOperation("bind", request); }
    profile(request) { return this.invokeAccountOperation("profile", request); }
    setDefault(request) { return this.invokeAccountOperation("setDefault", request); }
    async invokeAccountOperation(method, input) {
      // Read this.ctx at the method boundary: Cordis/Gateway supplies the current
      // call-derived Context containing invocation and the correct Host/principal.
      const ctx = this.ctx;
      try {
        requireOwner(ctx);
        const request = requestOf(method, input);
        return await scope.run(ctx, async () => {
          if (method === "bind") {
            const result = await this.coordinator.bind(request);
            requireOwner(ctx);
            if (await authorizeSession(request.sessionId) !== true) throw fail("SESSION_FORBIDDEN");
            requireOwner(ctx);
            return { accepted: selectionOf(result.accepted), ...stateOf(result, request.sessionId) };
          }
          const state = await this.coordinator.read({ sessionId: request.sessionId });
          const outputState = stateOf(state, request.sessionId);
          requireOwner(ctx);
          if (await authorizeSession(request.sessionId) !== true) throw fail("SESSION_FORBIDDEN");
          if (method === "catalog") {
            const result = await handlers.catalog({ sessionId: request.sessionId, state: outputState }, ctx);
            requireOwner(ctx);
            if (await authorizeSession(request.sessionId) !== true) throw fail("SESSION_FORBIDDEN");
            // Profile/quota collection may reconcile the registry or overlap a
            // model change. Re-read ordinary Session state instead of returning
            // the stale pre-handler selected-route snapshot.
            const latest = await this.coordinator.read({ sessionId: request.sessionId });
            requireOwner(ctx);
            if (await authorizeSession(request.sessionId) !== true) throw fail("SESSION_FORBIDDEN");
            requireOwner(ctx);
            const accounts = Array.isArray(result) ? result : result?.accounts;
            if (!Array.isArray(accounts)) throw fail("INTERNAL_ERROR");
            return { ...stateOf(latest, request.sessionId), accounts: accounts.map(publicAccount), notice: publicSessionFailureNotice(result?.notice, request.sessionId), ...(typeof result?.signingIn === "boolean" ? { signingIn: result.signingIn } : {}) };
          }
          const result = await handlers[method](request, ctx);
          requireOwner(ctx);
          if (await authorizeSession(request.sessionId) !== true) throw fail("SESSION_FORBIDDEN");
          requireOwner(ctx);
          if (result?.ok === false) throw fail(method === "profile" ? "ACCOUNT_PROFILE_FAILED" : "DEFAULT_ACCOUNT_FAILED");
          if (method === "profile") return { ok: true, ...(typeof result?.avatarUrl === "string" ? { avatarUrl: result.avatarUrl } : {}) };
          return { ok: true, ...(accountId(result?.defaultAccountId) ? { defaultAccountId: result.defaultAccountId } : {}) };
        });
      } catch (error) { throw safeError(error); }
    }
  }
  for (const method of ["catalog", "bind", "profile", "setDefault"]) {
    Remote({ resources: { session: (request) => request?.sessionId } })(CopilotAccountsRemote.prototype[method], {
      kind: "method", name: method, static: false, private: false,
      addInitializer(initialize) { initializers.push(initialize); },
    });
  }
  return CopilotAccountsRemote;
}
