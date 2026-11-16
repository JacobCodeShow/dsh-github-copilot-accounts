// Host-only transport/replay state derived through the normative Session
// projection registry. No direct log readers, plugin records or history edits.
import { createHash, randomUUID } from "node:crypto";
import { isAccountCredentialIdentity } from "./account-identity.mjs";
import { GLOBAL_COPILOT_ROUTE, isAccountRoute, accountRouteId } from "./account-route-id.mjs";

const SLOT = /^copilot-auth\/account-[a-z0-9-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const CRYPTO_FIELDS = ["sessionId", "accountId", "credentialIdentity", "model", "apiContext", "replayResetEpoch"];
const TRANSPORT_FIELDS = ["sessionId", "accountId", "credentialIdentity", "logicalProvider", "model", "reasoningEffort", "purpose", "defaultEpoch", "apiContext", "selectionSeq", "failureSeq", "contextSeq", "resetEpoch", "replayResetEpoch"];
const string = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096;
const optionalString = (value) => value === null || string(value);
const seq = (value) => value === null || Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const field = (value) => value === undefined ? null : value;
const copy = (value) => structuredClone(value);
const routeOf = (value) => string(value?.provider) && string(value?.model) && optionalString(field(value.reasoningEffort))
  ? { provider: value.provider, model: value.model, reasoningEffort: field(value.reasoningEffort) } : null;
const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model && a?.reasoningEffort === b?.reasoningEffort;
export const requestContextKey = (value) => createHash("sha256").update(JSON.stringify(["copilot-replay-v1", ...CRYPTO_FIELDS.map((key) => value[key])])).digest("hex");
export const requestTransportKey = (value) => createHash("sha256").update(JSON.stringify(["copilot-affinity-v1", ...TRANSPORT_FIELDS.map((key) => value[key])])).digest("hex");
const wireId = (hostNonce, contextKey, epoch) => {
  const bytes = createHash("sha256").update(JSON.stringify(["copilot-transport-v1", hostNonce, contextKey, epoch])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
function validCache(value) {
  if (!value || value.version !== 1 || value.trusted !== true || !string(value.epoch) || !HASH.test(value.contextKey)
    || !HASH.test(value.transportContextKey) || !isAccountCredentialIdentity(value.credentialIdentity) || !string(value.sessionId) || !string(value.accountId) || !SLOT.test(value.accountId) || !string(value.logicalProvider) || !string(value.model)
    || !["reasoningEffort", "purpose", "defaultEpoch", "apiContext", "resetEpoch", "replayResetEpoch"].every((key) => optionalString(value[key]))
    || !["selectionSeq", "failureSeq", "contextSeq"].every((key) => seq(value[key]))) return false;
  try { return requestContextKey(value) === value.contextKey && requestTransportKey(value) === value.transportContextKey; } catch { return false; }
}
function envelopeCache(envelope, source) {
  const cache = envelope?.cache;
  if (source?.provider !== GLOBAL_COPILOT_ROUTE && !isAccountRoute(source?.provider)) return null;
  if (envelope?.kind !== "copilot-account" || envelope.version !== 1 || envelope.accountId !== cache?.accountId || envelope.credentialIdentity !== cache?.credentialIdentity
    || !validCache(cache) || cache.logicalProvider !== source?.provider || cache.model !== source?.model) return null;
  if (isAccountRoute(source.provider) && source.provider !== accountRouteId(cache.accountId)) return null;
  if (cache.apiContext !== null && envelope.native?.response?.api !== undefined && envelope.native.response.api !== cache.apiContext) return null;
  return copy(cache);
}
function lastFinish(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index--) {
    const record = stream[index];
    if (record?.type === "chunk" && record.chunk?.type === "finish") return record.chunk;
  }
}

export class SessionRequestStateError extends Error {
  constructor(code = "ACCOUNT_REQUEST_STATE_UNAVAILABLE") { super("Copilot request state is unavailable"); this.name = "SessionRequestStateError"; this.code = code; }
}
export function createSessionRequestProjection(Schema, { lastAssistantStreamChunk } = {}) {
  if (typeof Schema?.object !== "function" || typeof Schema?.union !== "function") throw new SessionRequestStateError();
  const nullable = (value) => Schema.union([Schema.const(null), value]);
  const nullableString = () => nullable(Schema.string());
  const nullableSeq = () => nullable(Schema.natural());
  const cacheSchema = Schema.object({ version: Schema.const(1), trusted: Schema.boolean(), epoch: Schema.string(), contextKey: Schema.string(), transportContextKey: Schema.string(),
    sessionId: nullableString(), accountId: Schema.string(), credentialIdentity: Schema.string(), logicalProvider: Schema.string(), model: Schema.string(),
    reasoningEffort: nullableString(), purpose: nullableString(), defaultEpoch: nullableString(), apiContext: nullableString(),
    selectionSeq: nullableSeq(), failureSeq: nullableSeq(), contextSeq: nullableSeq(), resetEpoch: nullableString(), replayResetEpoch: nullableString() });
  const definition = {
    key: "copilotAccountRequestState", stateVersion: 2,
    stateSchema: Schema.object({ selectionSeq: nullableSeq(), failureSeq: nullableSeq(), contextSeq: nullableSeq(),
      route: nullable(Schema.object({provider:Schema.string(),model:Schema.string(),reasoningEffort:nullableString()})), success: nullable(cacheSchema) }),
    init: () => ({ selectionSeq: null, failureSeq: null, contextSeq: null, route: null, success: null }),
    apply(state, event) {
      if (!Number.isSafeInteger(event?.seq) || event.seq < 0) return state;
      if (event.type === "model/selection") return { ...state, selectionSeq: event.seq, route: routeOf(event.data) };
      if (event.type === "request/header") {
        const route = routeOf(event.data?.header?.config);
        return route !== null && !sameRoute(route, state.route) ? { ...state, route, selectionSeq: event.seq } : state;
      }
      // Failed/retried/cancelled attempts never enter model-visible history and
      // may have no finish record at all. The known event itself is the boundary.
      if (event.type === "assistant/attempt") return { ...state, failureSeq: event.seq };
      if (["compaction/summary", "compaction/prune", "compaction/end", "feedback/message-put", "feedback/message-delete"].includes(event.type)) return { ...state, contextSeq: event.seq };
      if (event.type !== "assistant/message") return state;
      const source = event.data?.message?.source;
      let finish;
      try { finish = lastAssistantStreamChunk ? lastAssistantStreamChunk(event.data?.stream, "finish") : lastFinish(event.data?.stream); } catch { /* malformed metadata cannot restore replay */ }
      if (finish?.reason?.kind === "error" || finish?.reason?.kind === "aborted") return { ...state, failureSeq: event.seq, success: null };
      const fromSource = envelopeCache(source?.replayState, source);
      const fromStream = envelopeCache(finish?.replayState, source);
      const malformedSource = source?.replayState !== undefined && fromSource === null;
      const mismatch = fromSource !== null && fromStream !== null && (fromSource.epoch !== fromStream.epoch || fromSource.contextKey !== fromStream.contextKey);
      const success = malformedSource || mismatch ? null : fromSource ?? fromStream;
      return { ...state, success };
    },
  };
  return definition;
}

export async function createSessionRequestState({ sessionProjections, Schema, resolveSession, hostNonce,
  uuid = randomUUID, lastAssistantStreamChunk } = {}) {
  if (typeof sessionProjections?.register !== "function" || typeof resolveSession !== "function" || typeof uuid !== "function") throw new SessionRequestStateError();
  const nonce = hostNonce ?? uuid();
  if (!string(nonce)) throw new SessionRequestStateError();
  const definition = createSessionRequestProjection(Schema, { lastAssistantStreamChunk });
  const projection = await sessionProjections.register(definition);
  if (typeof projection?.stateOf !== "function" || typeof projection.dispose !== "function") throw new SessionRequestStateError();
  let closed = false;
  const resetEpochs = new Map(), replayResets = new Map(), notices = new Map(), failureListeners = new Set();
  const requestTickets = new Map(), lastOrdinaryScopes = new Map();
  let observeRelease;
  const requireOpen = () => { if (closed) throw new SessionRequestStateError(); };
  const nextId = () => { const id = uuid(); if (!string(id)) throw new SessionRequestStateError(); return id; };
  const reset = (sessionId, details = {}) => {
    requireOpen();
    if (!string(sessionId)) throw new SessionRequestStateError("INVALID_ACCOUNT_SCOPE");
    resetEpochs.set(sessionId, nextId());
    if (details.notice !== true) return null;
    const notice = { id: nextId(), sessionId, code: "ACCOUNT_REQUEST_FAILED",
      ...(Number.isSafeInteger(details.turn) && details.turn >= 0 ? { turn: details.turn } : {}),
      ...(Number.isSafeInteger(details.step) && details.step >= 0 ? { step: details.step } : {}),
      ...(string(details.accountId) && SLOT.test(details.accountId) ? { accountId: details.accountId } : {}),
      ...(string(details.logicalProvider) ? { logicalProvider: details.logicalProvider } : {}),
      ...(string(details.model) ? { model: details.model } : {}) };
    notices.set(sessionId, notice); return copy(notice);
  };
  return Object.freeze({
    async scopeForRequest({ sessionId, accountId, credentialIdentity, logicalProvider, model, reasoningEffort, purpose, defaultEpoch, apiContext, signal } = {}) {
      requireOpen(); signal?.throwIfAborted();
      if (sessionId !== undefined && !string(sessionId) || !string(accountId) || !SLOT.test(accountId) || !isAccountCredentialIdentity(credentialIdentity) || !string(logicalProvider) || !string(model)
        || ![reasoningEffort, purpose, defaultEpoch, apiContext].every((value) => optionalString(field(value)))) throw new SessionRequestStateError("INVALID_ACCOUNT_SCOPE");
      let session, state, trusted = false;
      if (sessionId !== undefined) {
        try {
          session = resolveSession(sessionId);
          if (session?.id === sessionId) {
            state = projection.stateOf(session);
            trusted = ["selectionSeq", "failureSeq", "contextSeq"].every((key) => seq(state?.[key]));
          }
        } catch { /* unknown/ended Session is a fresh untrusted direct-call scope */ }
      }
      signal?.throwIfAborted(); requireOpen();
      const previous = trusted && validCache(state?.success) ? state.success : null;
      const fields = { sessionId: field(sessionId), accountId, credentialIdentity, logicalProvider, model,
        reasoningEffort: field(reasoningEffort), purpose: field(purpose), defaultEpoch: field(defaultEpoch), apiContext: field(apiContext),
        selectionSeq: trusted ? state.selectionSeq : null, failureSeq: trusted ? state.failureSeq : null,
        contextSeq: trusted ? state.contextSeq : null,
        resetEpoch: sessionId === undefined ? null : resetEpochs.get(sessionId) ?? (previous?.sessionId === sessionId ? previous.resetEpoch : null),
        replayResetEpoch: sessionId === undefined ? null : replayResets.get(sessionId) ?? (previous?.sessionId === sessionId ? previous.replayResetEpoch : null),
      };
      const contextKey = requestContextKey(fields), transportContextKey = requestTransportKey(fields);
      // Same-account reasoning signatures may still be required after a network
      // error, compaction, effort change or Alias<->managed-default switch. Only
      // the most recent successful account/model/API/SID scope can restore them.
      const replayEpoch = trusted && previous?.contextKey === contextKey ? previous.epoch : nextId();
      const cacheMeta = Object.freeze({ version: 1, trusted, ...fields, epoch: replayEpoch, contextKey, transportContextKey });
      if (sessionId !== undefined && purpose == null) {
        const last = lastOrdinaryScopes.get(sessionId);
        const changed = (prior) => prior !== null && prior !== undefined
          && (prior.accountId !== accountId || prior.credentialIdentity !== credentialIdentity || prior.logicalProvider !== logicalProvider || prior.defaultEpoch !== fields.defaultEpoch);
        const ticket = requestTickets.get(sessionId);
        // Auxiliary title/compaction scopes never overwrite the conversation's
        // current request plan. A public request hook clears this ticket before
        // preparation, so preparation failures cannot reuse an old SDK plan.
        if (ticket !== undefined && ticket.provider === logicalProvider && ticket.model === model && ticket.scope === undefined) {
          ticket.scope = { accountId, credentialIdentity, logicalProvider, model, defaultEpoch: fields.defaultEpoch,
            switchSensitive: trusted && (changed(previous) || changed(last)) };
        }
        lastOrdinaryScopes.set(sessionId, { accountId, credentialIdentity, logicalProvider, defaultEpoch: fields.defaultEpoch });
      }
      return Object.freeze({ transportSessionId: wireId(nonce, transportContextKey, replayEpoch), replayEpoch, contextKey, transportContextKey, cacheMeta });
    },
    reset,
    resetReplay(sessionId) { requireOpen(); if (!string(sessionId)) throw new SessionRequestStateError("INVALID_ACCOUNT_SCOPE"); replayResets.set(sessionId, nextId()); return reset(sessionId); },
    notice(sessionId) { requireOpen(); const value = notices.get(sessionId); return value === undefined ? null : copy(value); },
    observeFailures(ctx, { isManagedProvider, ownsAgent } = {}) {
      requireOpen();
      if (typeof ctx?.on !== "function" || typeof isManagedProvider !== "function" || ownsAgent !== undefined && typeof ownsAgent !== "function") throw new SessionRequestStateError();
      const owned = (agent) => {
        try { const id = agent?.session?.id; return string(id) && resolveSession(id) === agent.session && (ownsAgent === undefined || ownsAgent(agent) === true); }
        catch { return false; }
      };
      if (observeRelease !== undefined) return observeRelease;
      const seen = new Map();
      const releaseRequest = ctx.on("agent/request", async (payload, next) => {
        const id = payload?.agent?.session?.id;
        const ownedBefore = owned(payload?.agent);
        if (ownedBefore) { requestTickets.delete(id); notices.delete(id); seen.delete(id); }
        const request = await next();
        try {
          if (!closed && ownedBefore && owned(payload?.agent) && string(request?.provider) && string(request?.model) && isManagedProvider(request.provider) === true) {
            requestTickets.set(id, { turn: payload.turn, step: payload.step, provider: request.provider, model: request.model, scope: undefined });
          }
        } catch { /* observation never changes the proposed native request */ }
        return request;
      }, { prepend: true, global: true });
      const releaseError = ctx.on("agent/request-error", async (payload, next) => {
        const decision = await next(); // Never add retry or hide the framework's decision/error.
        try {
          if (closed || !owned(payload?.agent) || decision?.kind === "retry" || payload?.signal?.aborted || isManagedProvider(payload?.provider) !== true) return decision;
          const id = payload?.agent?.session?.id;
          if (!string(id)) return decision;
          const identity = JSON.stringify([payload.turn, payload.step, payload.provider]);
          if (seen.get(id) !== identity) {
            seen.set(id, identity);
            const ticket = requestTickets.get(id), plan = ticket?.scope;
            const selected = payload.agent.model?.current?.();
            const currentSelection = selected === undefined || selected.provider === plan?.logicalProvider && selected.model === plan?.model;
            const showNotice = plan?.switchSensitive === true && ticket.turn === payload.turn && ticket.step === payload.step
              && ticket.provider === payload.provider && plan.logicalProvider === payload.provider && currentSelection;
            reset(id, { turn: payload.turn, step: payload.step, notice: showNotice,
              accountId: plan?.accountId, logicalProvider: plan?.logicalProvider, model: plan?.model });
          }
        } catch { /* an observer/classifier must never change native retry/error flow */ }
        return decision;
      }, { prepend: true, global: true });
      const dispose = () => { failureListeners.delete(dispose); releaseRequest(); releaseError(); seen.clear(); requestTickets.clear(); if (observeRelease === dispose) observeRelease = undefined; };
      observeRelease = dispose; failureListeners.add(dispose); return dispose;
    },
    async dispose() { if (closed) return; closed = true; for (const release of [...failureListeners]) release(); resetEpochs.clear(); replayResets.clear(); notices.clear(); requestTickets.clear(); lastOrdinaryScopes.clear(); await projection.dispose(); },
  });
}
