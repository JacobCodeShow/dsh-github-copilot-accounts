// Logical default router. Resolution supplies an already-known account adapter;
// this module never reads credentials, matches OAuth grants, or performs HTTP.
import { GLOBAL_COPILOT_ROUTE, accountRouteId } from "./account-route-id.mjs";
import { withAccountRequestContext } from "./account-request-context.mjs";
const object = (value) => value !== null && typeof value === "object";
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const validEpoch = (value) => typeof value === "string" && value !== "" || Number.isSafeInteger(value) && value >= 0;
const OVERRIDES = ["apiKey", "apiKeyEnv", "auth", "env", "credential", "credentials", "headers", "baseURL", "baseUrl"];

export class ManagedGlobalAccountError extends Error {
  constructor(message, code) { super(message); this.name = "ManagedGlobalAccountError"; this.code = code; }
}
function waitFor(operation, signal) {
  const promise = Promise.resolve(operation);
  if (!signal) return promise;
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) onAbort();
  });
}

/**
 * Project logical history only when its explicit envelope proves actual account
 * ownership. An exact captured alias may retain same-account cryptographic
 * provenance across logical-route changes, but never a raw/shared builtin route.
 * Contiguous-account, cache and epoch validity belong to the request-state manager.
 */
export function managedMessagesToAccount(messages, capture) {
  return (messages ?? []).map((message) => {
    const result = copy(message);
    if (result.role !== "assistant" || !object(result.source)) return result;
    const source = result.source, replay = source.replayState;
    const owned = (source.provider === GLOBAL_COPILOT_ROUTE || source.provider === capture.routeId) && replay?.kind === "copilot-account"
      && replay.version === 1 && replay.accountId === capture.accountId;
    delete source.replayState;
    if (owned) { source.provider = capture.routeId; source.replayState = replay; }
    return result;
  });
}

/**
 * Initialized stable public default route. Resolver contract:
 * resolveDefault() -> {accountId,routeId,adapter,defaultEpoch} OR unavailable.
 * It MUST reject/return unavailable for explicit auth overrides, unmatched OAuth,
 * missing records, unknown identities or disabled account routes; no env fallback.
 *
 * refreshDefault() eagerly updates synchronous registry metadata. Parent must call
 * it and synchronously registration.replace() after default/profile changes; no
 * delegate is ever disposed by this router. onPublish is synchronous/updates only.
 */
export async function createManagedGlobalAdapter({ LlmAdapter, resolveDefault,
  displayName = "GitHub Copilot", onPublish, LlmError = ManagedGlobalAccountError } = {}) {
  const fail = (message, code) => new LlmError(message, code);
  const unavailable = () => fail("Default Copilot account is unavailable", "ACCOUNT_UNAVAILABLE");
  if (typeof LlmAdapter !== "function" || typeof resolveDefault !== "function" || (onPublish !== undefined && typeof onPublish !== "function")) {
    throw fail("Managed Copilot route integrations are unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
  }
  const lifecycle = new AbortController();
  let disposed = false, remembered, metadataError = true, publicationBlocked = false, revision = 0;
  const label = () => {
    try { const name = typeof displayName === "function" ? displayName() : displayName; return typeof name === "string" && name !== "" ? name : "GitHub Copilot"; }
    catch { return "GitHub Copilot"; }
  };
  const own = (provider) => {
    if (provider !== GLOBAL_COPILOT_ROUTE) throw fail("Managed router does not own this provider", "NO_ADAPTER");
    if (disposed) throw unavailable();
  };
  const signalFor = (...signals) => {
    const values = [...new Set([lifecycle.signal, ...signals].filter(Boolean))];
    return values.length === 1 ? values[0] : AbortSignal.any(values);
  };
  const noOverrides = (options) => {
    if (OVERRIDES.some((key) => Object.hasOwn(options, key) && options[key] !== undefined)) throw unavailable();
  };
  const validate = (value) => {
    if (!object(value) || value.unavailable === true || value.available === false || value.apiKeyOverride === true
      || value.oauthMatched === false || value.recordMissing === true || value.error !== undefined || !validEpoch(value.defaultEpoch)) throw unavailable();
    let canonical;
    try { canonical = accountRouteId(value.accountId); } catch { throw unavailable(); }
    if (value.routeId !== canonical || value.adapter?.accountId !== value.accountId || value.adapter?.routeId !== canonical
      || ["providerInfo", "listModels", "resolveModel", "prepareCall", "stream"].some((method) => typeof value.adapter?.[method] !== "function")) throw unavailable();
    const info = value.adapter.providerInfo(canonical);
    if (!object(info) || info.id !== canonical) throw unavailable();
    return Object.freeze({ accountId: value.accountId, routeId: canonical, adapter: value.adapter, defaultEpoch: value.defaultEpoch });
  };
  const resolve = async (signal, request = true) => {
    own(GLOBAL_COPILOT_ROUTE); signal?.throwIfAborted();
    if (request && publicationBlocked) throw unavailable();
    try {
      const value = await waitFor(Promise.resolve().then(() => resolveDefault()), signal);
      own(GLOBAL_COPILOT_ROUTE); signal?.throwIfAborted();
      return validate(value);
    } catch {
      signal?.throwIfAborted();
      throw unavailable(); // Never forward resolver error text, causes, or credentials.
    }
  };
  const publicModel = (model, capture, expected) => {
    if (!object(model) || model.provider !== capture.routeId || typeof model.id !== "string" || model.id === ""
      || (expected !== undefined && model.id !== expected)) throw unavailable();
    return { ...copy(model), provider: GLOBAL_COPILOT_ROUTE };
  };
  const optionsFor = (options, capture, signal) => withAccountRequestContext({ ...options,
    provider: capture.routeId,
    messages: managedMessagesToAccount(options.messages, capture), signal },
  { logicalProvider: GLOBAL_COPILOT_ROUTE, defaultEpoch: capture.defaultEpoch });
  async function* forward(source, capture, signal) {
    signal.throwIfAborted();
    const iterator = source[Symbol.asyncIterator](); let exhausted = false;
    try {
      while (true) {
        const step = await waitFor(iterator.next(), signal);
        if (step.done) { exhausted = true; return; }
        signal.throwIfAborted();
        const chunk = step.value;
        if (chunk.type === "finish" && chunk.replayState !== undefined) {
          const replay = chunk.replayState;
          if (replay?.kind !== "copilot-account" || replay.version !== 1 || replay.accountId !== capture.accountId) {
            throw fail("Managed Copilot replay account provenance is unavailable", "ACCOUNT_REPLAY_INVALID");
          }
        }
        yield chunk; // Keep exact actual account/native/cache envelope, no double wrap.
      }
    } finally {
      if (!exhausted && iterator.return !== undefined) {
        try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* preserve original result */ }
      }
    }
  }
  let router;
  const refresh = async (initial = false) => {
    own(GLOBAL_COPILOT_ROUTE);
    const ticket = ++revision;
    let candidate;
    try { candidate = await resolve(lifecycle.signal, false); }
    catch { if (disposed) throw unavailable(); }
    if (disposed) throw unavailable();
    if (ticket !== revision) return remembered !== undefined;
    const previous = remembered, previousError = metadataError;
    remembered = candidate; metadataError = candidate === undefined; publicationBlocked = false;
    try {
      if (!initial && onPublish !== undefined) {
        const result = onPublish(Object.freeze({ adapter: router, provider: GLOBAL_COPILOT_ROUTE,
          available: candidate !== undefined, accountId: candidate?.accountId,
          accountRouteId: candidate?.routeId, defaultEpoch: candidate?.defaultEpoch }));
        if (result && typeof result.then === "function") { void Promise.resolve(result).catch(() => {}); throw unavailable(); }
      }
    } catch {
      remembered = previous; metadataError = previousError; publicationBlocked = true;
      throw unavailable();
    }
    return remembered !== undefined;
  };
  const invalidate = (accountId) => {
    if (accountId !== undefined && remembered !== undefined && remembered.accountId !== accountId) return false;
    revision++; // Cancel any speculative refresh started before removal/tombstoning.
    remembered = undefined; metadataError = true; publicationBlocked = false;
    return true;
  };
  class ManagedAdapter extends LlmAdapter {
    providerInfo(provider) {
      if (provider !== GLOBAL_COPILOT_ROUTE) throw fail("Managed router does not own this provider", "NO_ADAPTER");
      return { id: GLOBAL_COPILOT_ROUTE, name: label() };
    }
    providerRetryPolicy(provider) {
      if (provider !== GLOBAL_COPILOT_ROUTE) throw fail("Managed router does not own this provider", "NO_ADAPTER");
      if (disposed || !remembered) return undefined;
      const captured = remembered;
      try {
        const policy = captured.adapter.providerRetryPolicy?.(captured.routeId);
        if (policy && typeof policy.then === "function") { void Promise.resolve(policy).catch(() => {}); throw unavailable(); }
        return policy;
      } catch {
        if (remembered === captured) invalidate(captured.accountId);
        return undefined; // Root hub replacement must remain possible without a default.
      }
    }
    imageRequestPricing(provider, model) { own(provider); return remembered?.adapter.imageRequestPricing?.(remembered.routeId, model); }
    imageRequestTarget(provider, model, image) {
      own(provider); if (!remembered) throw unavailable();
      return remembered.adapter.imageRequestTarget(remembered.routeId, model, image);
    }
    async listModels(provider) {
      own(provider); const signal = lifecycle.signal, captured = await resolve(signal);
      const models = await waitFor(captured.adapter.listModels(captured.routeId), signal);
      own(provider); if (!Array.isArray(models)) throw unavailable();
      return models.map((model) => publicModel(model, captured));
    }
    async resolveModel(provider, model, signal) {
      own(provider); signal = signalFor(signal);
      const captured = await resolve(signal);
      const info = await waitFor(captured.adapter.resolveModel(captured.routeId, model, signal), signal);
      own(provider); return publicModel(info, captured, model);
    }
    async prepareCall(provider, model, signal) {
      own(provider); signal = signalFor(signal);
      const captured = await resolve(signal); // Exactly ONE default resolution for this prepared call.
      const call = await waitFor(captured.adapter.prepareCall(captured.routeId, model, signal), signal);
      own(provider); if (typeof call?.stream !== "function") throw unavailable();
      return { model: publicModel(call.model, captured, model), stream: (options) => {
        own(options.provider); noOverrides(options);
        if (options.model !== model) throw fail("Prepared managed model does not match request", "PREPARED_CALL_MISMATCH");
        const requestSignal = signalFor(signal, options.signal); requestSignal.throwIfAborted();
        // Never consult current global state here; only the captured account's
        // delegate may reject later deletion/revocation. Do not fallback.
        return forward(call.stream(optionsFor(options, captured, requestSignal)), captured, requestSignal);
      } };
    }
    stream(options) {
      own(options.provider); noOverrides(options);
      const prepared = this.prepareCall(options.provider, options.model, options.signal);
      void prepared.catch(() => {});
      return (async function* () { const call = await prepared; yield* call.stream(options); })();
    }
    refreshDefault() { return refresh(); }
    invalidateDefault(accountId) { return invalidate(accountId); }
    dispose() { if (disposed) return; disposed = true; lifecycle.abort(unavailable()); }
  }
  router = new ManagedAdapter();
  Object.defineProperties(router, { routeId: { value: GLOBAL_COPILOT_ROUTE, enumerable: true },
    defaultEpoch: { get: () => remembered?.defaultEpoch },
    defaultError: { get: () => disposed || metadataError || publicationBlocked ? { code: "ACCOUNT_UNAVAILABLE", message: "Default Copilot account is unavailable" } : undefined } });
  await refresh(true); // Unknown initial default does not register/dispatch a legacy fallback.
  return router;
}
