// Account-scoped bridge. This module imports no DSH runtime, reads no ambient
// credentials and never makes HTTP requests. Runtime classes/factories are injected.
import { normalizeDomain } from "./shared.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { accountCredentialIdentity } from "./account-identity.mjs";
import { ACCOUNT_REQUEST_CONTEXT } from "./account-request-context.mjs";
import { GLOBAL_COPILOT_ROUTE, isAccountRoute, accountRouteId } from "./account-route-id.mjs";

export const NATIVE_COPILOT_PROVIDER = "github-copilot";
const AFFINITY_HEADERS = ["session_id", "x-session-id", "x-session-affinity", "x-client-request-id"];
const TRANSPORT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KEY = /^copilot-auth\/account-[a-z0-9-]+$/;
const ROUTE = /^[a-z][a-z0-9-]*$/;
const AUTH_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "api-key", "cookie"]);
const GUARD_PREFIX = "copilot-account-protocol-guard:";
const GUARD_MESSAGES = Object.freeze({
  UNKNOWN_MODEL: "Model is not available for this Copilot account",
  ACCOUNT_UNAVAILABLE: "Copilot account is unavailable for this request",
  INVALID_ACCOUNT_GRANT: "Invalid account model availability",
});

export class AccountAdapterError extends Error {
  constructor(message, code) { super(message); this.name = "AccountAdapterError"; this.code = code; }
}
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const abort = (signal) => { signal?.throwIfAborted(); };
function waitFor(operation, signal) {
  const promise = Promise.resolve(operation);
  if (!signal) return promise;
  if (signal.aborted) { void promise.catch(() => {}); return Promise.reject(signal.reason); }
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    if (signal.aborted) onAbort();
  });
}
function jsonImage(value) {
  if (Array.isArray(value)) return value.map((entry) => entry === undefined ? null : jsonImage(entry));
  if (isObject(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, jsonImage(entry)]));
  }
  return value;
}
function safeBearer(value) {
  if (typeof value !== "string" || value.trim() === "" || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try { new Headers({ authorization: `Bearer ${value}` }); return true; } catch { return false; }
}
function usableGrant(record) {
  const payload = record?.payload;
  if (record?.kind !== "grant" || !isObject(payload) || payload.type !== "oauth"
    || !safeBearer(payload.refresh) || !safeBearer(payload.access)
    || typeof payload.expires !== "number" || !Number.isFinite(payload.expires)
    || record.disabled === true || payload.disabled === true
    || payload.account?.disabled === true || payload.account?.enabled === false) return false;
  const enterprise = payload.enterpriseUrl;
  const metaDomain = normalizeDomain(payload.account?.domain);
  if (enterprise === undefined || enterprise === null || enterprise === "") {
    // Never let an imported GHE-labelled grant silently take the native public
    // GitHub fallback because its required enterprise identity is missing.
    return metaDomain === null || metaDomain === "github.com";
  }
  return normalizeDomain(enterprise) !== null;
}
// Shape validation only; remote entitlement/authentication remains server-owned.
export { usableGrant as isUsableAccountRecord };
function checkHeaders(headers, fail) {
  for (const [name] of headers instanceof Headers ? headers : Object.entries(headers ?? {})) {
    if (AUTH_HEADERS.has(name.toLowerCase())) throw fail("Account routes do not allow credential header overrides", "ACCOUNT_AUTH_OVERRIDE");
  }
}

/**
 * Map the native pi-ai id to ONE immutable plugin slot. modifyRecord must provide
 * the DSH per-key serialized read/mutate/write contract (including async mutation).
 * Once a refresh mutation starts it may finish/persist despite caller cancellation,
 * matching pi-ai's rotated-token safety contract. No operation uses the shared key.
 */
export function createAccountCredentialStore({ credentials, accountId, isEnabled = () => true, expectedIdentity, LlmError = AccountAdapterError }) {
  const fail = (message, code) => new LlmError(message, code);
  if (typeof accountId !== "string" || !KEY.test(accountId)) throw fail("Invalid Copilot account slot", "INVALID_ACCOUNT_ID");
  if (!credentials || typeof credentials.readRecord !== "function" || typeof credentials.modifyRecord !== "function") {
    throw fail("Account credential service is unavailable", "ACCOUNT_UNAVAILABLE");
  }
  const checkId = (id) => {
    if (id !== NATIVE_COPILOT_PROVIDER) throw fail("Account store does not own this provider", "NO_ADAPTER");
  };
  const enabled = async (signal) => {
    abort(signal);
    let allowed;
    try { allowed = await waitFor(Promise.resolve().then(isEnabled), signal); }
    catch (error) { abort(signal); throw fail("Copilot account is unavailable", "ACCOUNT_UNAVAILABLE"); }
    abort(signal);
    if (allowed !== true) throw fail("Copilot account is unavailable", "ACCOUNT_UNAVAILABLE");
  };
  const requireRecord = (record) => {
    if (!usableGrant(record)) throw fail("Copilot account is missing, disabled, or not signed in", "ACCOUNT_UNAVAILABLE");
    const expected = expectedIdentity?.();
    if (expected !== undefined) {
      try { if (accountCredentialIdentity(record.payload) !== expected) throw new Error(); }
      catch { throw fail("Copilot account identity changed", "ACCOUNT_UNAVAILABLE"); }
    }
    return record;
  };
  const readRecord = async (signal) => {
    await enabled(signal);
    let record;
    try { record = await waitFor(credentials.readRecord(accountId), signal); }
    catch (error) { abort(signal); throw fail("Copilot account credentials are unavailable", "ACCOUNT_UNAVAILABLE"); }
    await enabled(signal);
    return requireRecord(record);
  };
  return Object.freeze({
    async read(providerId, options) {
      checkId(providerId);
      return clone((await readRecord(options?.signal)).payload);
    },
    async list(options) {
      await readRecord(options?.signal);
      return [{ providerId: NATIVE_COPILOT_PROVIDER, type: "oauth" }];
    },
    async modify(providerId, mutate, options) {
      checkId(providerId);
      await enabled(options?.signal);
      const operation = credentials.modifyRecord(accountId, async (current) => {
        // A cancelled lock wait must never start a refresh later in the queue.
        await enabled(options?.signal);
        const previous = requireRecord(current);
        const next = await mutate(clone(previous.payload));
        if (next === undefined) return undefined;
        if (!isObject(next) || next.type !== "oauth") throw fail("Invalid Copilot OAuth refresh result", "INVALID_ACCOUNT_GRANT");
        const payload = jsonImage(clone(next));
        // Native refresh owns OAuth fields, never plugin account identity metadata.
        if (previous.payload.account !== undefined) payload.account = clone(previous.payload.account);
        else delete payload.account;
        if (!usableGrant({ kind: "grant", payload })) throw fail("Invalid Copilot OAuth refresh result", "INVALID_ACCOUNT_GRANT");
        return { kind: "grant", payload };
      });
      const committed = await waitFor(operation, options?.signal);
      return clone(requireRecord(committed).payload);
    },
    async delete(providerId, options) {
      checkId(providerId);
      await readRecord(options?.signal);
      if (typeof credentials.deleteRecord !== "function") throw fail("Account removal is unavailable", "ACCOUNT_UNAVAILABLE");
      abort(options?.signal);
      await credentials.deleteRecord(accountId);
    },
  });
}

/** Convert durable alias history only when both route AND account provenance match. */
export function accountMessagesToNative(messages, { routeId, accountId, scope, credentialIdentity }) {
  return (messages ?? []).map((message) => {
    if (message.role !== "assistant") return clone(message);
    const original = isObject(message.source) ? message.source : {};
    const source = { ...clone(original),
      provider: typeof original.provider === "string" && original.provider ? original.provider : "copilot-foreign",
      model: typeof original.model === "string" && original.model ? original.model : "unknown" };
    const envelope = original.replayState;
    const native = envelope?.native;
    const managedSource = original.provider === routeId || original.provider === GLOBAL_COPILOT_ROUTE
      || isAccountRoute(original.provider) && original.provider === accountRouteId(accountId);
    const cache = envelope?.cache;
    const sameCryptoScope = scope === undefined || scope.cacheMeta?.trusted === true && cache?.version === 1 && cache.trusted === true
      && cache.epoch === scope.replayEpoch && cache.contextKey === scope.contextKey && cache.accountId === accountId
      && cache.credentialIdentity === scope.cacheMeta.credentialIdentity
      && cache.model === scope.cacheMeta.model && cache.apiContext === scope.cacheMeta.apiContext;
    const owned = (scope === undefined ? original.provider === routeId : managedSource && original.provider !== NATIVE_COPILOT_PROVIDER)
      && (credentialIdentity === undefined || envelope?.credentialIdentity === credentialIdentity)
      && sameCryptoScope && envelope?.kind === "copilot-account"
      && envelope.version === 1 && envelope.accountId === accountId && isObject(native)
      && native.response?.provider === NATIVE_COPILOT_PROVIDER && native.response?.model === original.model
      && (scope?.cacheMeta?.apiContext == null || native.response?.api === scope.cacheMeta.apiContext);
    delete source.replayState;
    if (owned) { source.provider = NATIVE_COPILOT_PROVIDER; source.replayState = clone(native); }
    else if (scope !== undefined && source.provider === NATIVE_COPILOT_PROVIDER) source.provider = "copilot-foreign";
    // Foreign/old/malformed replay is intentionally dropped. Keep its non-native
    // source identity so the native adapter projects provider-neutral history.
    return { ...clone(message), source };
  });
}

const DEFAULT_PROFILE = Object.freeze({
  streamIdleTimeoutMs: 300000, maxRequestImageBytes: 20 * 1024 * 1024,
  maxRequestImages: 50, imageOffloadCountQuantum: 10,
  requestImagePixelBudget: 2048 * 2048, requestImageMaxBytes: 1024 * 1024,
});

/**
 * Public account route around an isolated, internally native PiAiAdapter.
 * createNativeProvider() must return the installed githubCopilotProvider factory
 * result. Only the public LLM boundary is aliased; native models/auth stay native.
 * profileDefaults is a compiled pi-ai profile fragment, not raw settings schema.
 */
export function createAccountAdapter({ LlmAdapter, PiAiAdapter, createNativeProvider,
  credentials, accountId, routeId, displayName = routeId, profileDefaults = {},
  isEnabled = () => true, modelIds, resolveAttachments, resolveImageAccess,
  prepareHeaders, onReplayDegrade, beforeDispatch, requestScope, LlmError = AccountAdapterError } = {}) {
  const fail = (message, code) => new LlmError(message, code);
  if (typeof LlmAdapter !== "function" || typeof PiAiAdapter !== "function" || typeof createNativeProvider !== "function") {
    throw fail("Copilot adapter runtime is unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
  }
  if (typeof routeId !== "string" || !ROUTE.test(routeId) || routeId === NATIVE_COPILOT_PROVIDER) {
    throw fail("Invalid account provider route", "INVALID_ACCOUNT_ROUTE");
  }
  if (typeof isEnabled !== "function") throw fail("Invalid account lifecycle predicate", "INVALID_ACCOUNT_CONFIG");
  if (beforeDispatch !== undefined && typeof beforeDispatch !== "function") throw fail("Invalid account dispatch hook", "INVALID_ACCOUNT_CONFIG");
  if (requestScope !== undefined && typeof requestScope !== "function") throw fail("Invalid account request scope hook", "INVALID_ACCOUNT_CONFIG");
  const headerContext = new AsyncLocalStorage();
  const label = () => {
    const value = typeof displayName === "function" ? displayName() : displayName;
    return typeof value === "string" && value.trim() !== "" ? value : routeId;
  };
  checkHeaders(profileDefaults.headers, fail);
  const native = createNativeProvider();
  if (native?.id !== NATIVE_COPILOT_PROVIDER || typeof native.getModels !== "function"
    || typeof native.streamSimple !== "function" || !native.auth?.oauth) {
    throw fail("Native Copilot OAuth provider is unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
  }
  const catalog = clone(native.getModels());
  if (!Array.isArray(catalog) || catalog.some((m) => !isObject(m) || m.provider !== NATIVE_COPILOT_PROVIDER || typeof m.id !== "string")) {
    throw fail("Invalid native Copilot model catalog", "INVALID_ACCOUNT_CONFIG");
  }
  if (modelIds !== undefined && (!Array.isArray(modelIds) || modelIds.some((id) => typeof id !== "string"))) {
    throw fail("Invalid account model selection", "INVALID_ACCOUNT_CONFIG");
  }
  const selectedIds = modelIds === undefined ? undefined : new Set(modelIds);
  const defaults = { ...clone(profileDefaults), ...DEFAULT_PROFILE,
    ...Object.fromEntries(Object.keys(DEFAULT_PROFILE).filter((key) => profileDefaults[key] !== undefined).map((key) => [key, profileDefaults[key]])) };
  let disposed = false;
  const lifecycle = new AbortController();
  const signalFor = (...signals) => {
    const present = [...new Set([lifecycle.signal, ...signals].filter(Boolean))];
    return present.length === 1 ? present[0] : AbortSignal.any(present);
  };
  const credentialStore = createAccountCredentialStore({ credentials, accountId, LlmError, expectedIdentity: () => headerContext.getStore()?.credentialIdentity,
    isEnabled: async () => {
      if (disposed) return false;
      const allowed = await isEnabled();
      return !disposed && allowed === true;
    } });
  let profiles;
  let modelSignature;
  const guardedProtocol = (method) => (model, context, options) => {
    const signal = signalFor(options?.signal);
    return (async function* () {
      try {
        // Models.applyAuth may refresh OAuth AFTER outer preparation, changing
        // availability. Guard again immediately before the real protocol starts.
        const models = await available(signal);
        own(routeId); requireModel(models, model.id); abort(signal);
      } catch (error) {
        if (signal.aborted) throw error;
        const code = Object.hasOwn(GUARD_MESSAGES, error?.code) ? error.code : "ACCOUNT_UNAVAILABLE";
        // Native lazyStream flattens typed errors into errorMessage. An exact,
        // static private marker lets the public wrapper restore the safe code.
        throw fail(GUARD_PREFIX + code, code);
      }
      // Do not compare access equality: a concurrent refresh for this SAME
      // account can legitimately leave an older request token in flight.
      yield* native[method](model, context, { ...options, signal });
    })();
  };
  const guardFailure = (message) => {
    if (typeof message !== "string" || !message.startsWith(GUARD_PREFIX)) return undefined;
    const code = message.slice(GUARD_PREFIX.length);
    return Object.hasOwn(GUARD_MESSAGES, code) ? fail(GUARD_MESSAGES[code], code) : undefined;
  };
  const installModels = (models) => {
    const signature = JSON.stringify(models.map((m) => m.id));
    if (signature === modelSignature) return;
    const ownedModels = clone(models);
    const piProvider = { ...native, getModels: () => ownedModels, getAllModels: () => ownedModels,
      streamSimple: guardedProtocol("streamSimple"),
      ...(typeof native.stream === "function" ? { stream: guardedProtocol("stream") } : {}) };
    const profile = { ...defaults, provider: NATIVE_COPILOT_PROVIDER, displayName: label(),
      piProvider, configuredMaxTokens: new Map(profileDefaults.configuredMaxTokens ?? []),
      modelErrors: new Map(profileDefaults.modelErrors ?? []) };
    profiles = new Map([[NATIVE_COPILOT_PROVIDER, profile]]);
    modelSignature = signature;
  };
  installModels(catalog.filter((m) => selectedIds === undefined || selectedIds.has(m.id)));
  const inner = new PiAiAdapter({ profiles: () => profiles,
    // Explicit overrides and ambient environment must not bypass the account slot.
    resolveApiKey: async () => undefined,
    auth: { credentials: credentialStore, authContext: { env: async () => undefined, fileExists: async () => false } },
    resolveAttachments, resolveImageAccess,
    prepareHeaders: (request, headers) => {
      const frame = headerContext.getStore();
      const descriptor = { ...request, provider: frame?.logicalProvider ?? routeId };
      if (frame !== undefined) {
        if (frame.sessionId === undefined) delete descriptor.sessionId;
        else descriptor.sessionId = frame.sessionId;
      }
      const result = prepareHeaders ? prepareHeaders(Object.freeze(descriptor), headers) : headers;
      checkHeaders(result, fail);
      if (frame?.scope === undefined) return result;
      let scoped;
      try { scoped = new Headers(result); }
      catch { throw fail("Account request headers are unavailable", "ACCOUNT_REQUEST_STATE_UNAVAILABLE"); }
      // SDK-generated affinity uses the private Session UUID. Contributors see
      // the ORIGINAL public SID/provider but cannot overwrite that wire scope.
      for (const key of AFFINITY_HEADERS) if (scoped.has(key)) scoped.set(key, frame.scope.transportSessionId);
      return scoped;
    },
    onReplayDegrade: onReplayDegrade === undefined ? undefined : (info) => onReplayDegrade({ ...info, provider: routeId }),
  });
  const own = (provider) => {
    if (provider !== routeId) throw fail("Account adapter does not own this route", "NO_ADAPTER");
    if (disposed) throw fail("Copilot account route is disabled", "ACCOUNT_UNAVAILABLE");
  };
  const available = async (signal) => {
    const grant = await credentialStore.read(NATIVE_COPILOT_PROVIDER, { signal });
    abort(signal);
    let allowed;
    if (grant.availableModelIds !== undefined) {
      if (!Array.isArray(grant.availableModelIds) || grant.availableModelIds.some((id) => typeof id !== "string")) {
        throw fail("Invalid account model availability", "INVALID_ACCOUNT_GRANT");
      }
      allowed = new Set(grant.availableModelIds);
    }
    return catalog.filter((m) => (allowed === undefined || allowed.has(m.id)) && (selectedIds === undefined || selectedIds.has(m.id)));
  };
  const requireModel = (models, model) => {
    if (!models.some((entry) => entry.id === model)) throw fail("Model is not available for this Copilot account", "UNKNOWN_MODEL");
  };
  const aliasModel = (model) => ({ ...clone(model), provider: routeId });
  const toNativeOptions = (options, model, signal, scope, credentialIdentity) => {
    const request = { ...options };
    // These are not Harness GenerateOptions, but strip them defensively so a
    // caller (or a future inner adapter version) cannot override account auth.
    for (const key of ["apiKey", "env", "auth", "credential", "credentials", "headers", "baseURL", "baseUrl"]) delete request[key];
    delete request[ACCOUNT_REQUEST_CONTEXT];
    return { ...request, provider: NATIVE_COPILOT_PROVIDER, model,
      ...(scope === undefined ? {} : { sessionId: scope.transportSessionId }),
      messages: accountMessagesToNative(options.messages, { routeId, accountId, scope, credentialIdentity }),
      ...(signal === undefined ? {} : { signal }) };
  };
  class AccountAdapter extends LlmAdapter {
    providerInfo(provider) { own(provider); return { id: routeId, name: label() }; }
    providerRetryPolicy(provider) { own(provider); return inner.providerRetryPolicy?.(NATIVE_COPILOT_PROVIDER); }
    imageRequestPricing(provider, model) { own(provider); return inner.imageRequestPricing?.(NATIVE_COPILOT_PROVIDER, model); }
    imageRequestTarget(provider, model, image) {
      own(provider);
      return inner.imageRequestTarget(NATIVE_COPILOT_PROVIDER, model, image);
    }
    async listModels(provider) {
      own(provider);
      installModels(await available(lifecycle.signal));
      own(provider);
      return (await waitFor(inner.listModels(NATIVE_COPILOT_PROVIDER), lifecycle.signal)).map(aliasModel);
    }
    async resolveModel(provider, model, signal) {
      signal = signalFor(signal);
      own(provider); abort(signal);
      const models = await available(signal);
      own(provider); requireModel(models, model); installModels(models);
      const result = await waitFor(inner.resolveModel(NATIVE_COPILOT_PROVIDER, model, signal), signal);
      own(provider); return aliasModel(result);
    }
    async prepareCall(provider, model, signal) {
      signal = signalFor(signal);
      own(provider); abort(signal);
      const models = await available(signal);
      own(provider); requireModel(models, model); installModels(models);
      const call = await waitFor(inner.prepareCall(NATIVE_COPILOT_PROVIDER, model, signal), signal);
      own(provider);
      return { model: aliasModel(call.model), stream: (options) => this.streamPrepared(call, model, signal, options) };
    }
    async *streamPrepared(call, model, preparationSignal, options) {
      own(options.provider);
      if (options.model !== model) throw fail("Prepared account model does not match request", "PREPARED_CALL_MISMATCH");
      const signal = signalFor(preparationSignal, options.signal);
      abort(signal);
      let models = await available(signal);
      own(options.provider); requireModel(models, model); abort(signal);
      if (beforeDispatch !== undefined) {
        await waitFor(Promise.resolve().then(() => beforeDispatch(Object.freeze({ accountId, routeId, signal }))), signal);
        models = await available(signal);
        own(options.provider); requireModel(models, model); abort(signal);
      }
      let scope, credentialIdentity;
      try { credentialIdentity = accountCredentialIdentity(await credentialStore.read(NATIVE_COPILOT_PROVIDER, { signal })); }
      catch { abort(signal); throw fail("Copilot account identity is unavailable", "ACCOUNT_UNAVAILABLE"); }
      const inherited = options[ACCOUNT_REQUEST_CONTEXT];
      const logicalProvider = typeof inherited?.logicalProvider === "string" ? inherited.logicalProvider : routeId;
      const apiContext = catalog.find((entry) => entry.id === model)?.api;
      if (requestScope !== undefined) {
        try {
          scope = await waitFor(Promise.resolve().then(() => requestScope(Object.freeze({
            sessionId: options.sessionId, accountId, credentialIdentity, logicalProvider, model,
            reasoningEffort: options.reasoningEffort, purpose: options.purpose,
            defaultEpoch: inherited?.defaultEpoch, apiContext, signal,
          }))), signal);
          const cache = scope?.cacheMeta;
          if (!TRANSPORT_UUID.test(scope?.transportSessionId) || typeof scope?.replayEpoch !== "string"
            || !/^[a-f0-9]{64}$/.test(scope?.contextKey) || cache?.version !== 1 || typeof cache.trusted !== "boolean"
            || cache.epoch !== scope.replayEpoch || cache.contextKey !== scope.contextKey || cache.accountId !== accountId
            || cache.credentialIdentity !== credentialIdentity || cache.logicalProvider !== logicalProvider || cache.model !== model || cache.apiContext !== (apiContext ?? null)
            || cache.sessionId !== (options.sessionId ?? null)) throw fail("Invalid account request scope", "ACCOUNT_REQUEST_STATE_UNAVAILABLE");
          scope = clone(scope);
        } catch { abort(signal); throw fail("Copilot request state is unavailable", "ACCOUNT_REQUEST_STATE_UNAVAILABLE"); }
        models = await available(signal);
        own(options.provider); requireModel(models, model); abort(signal);
      }
      const frame = { sessionId: options.sessionId, logicalProvider, scope, credentialIdentity };
      const inRequest = (operation) => headerContext.run(frame, operation);
      // Do not install a newer profile here: call.stream owns the prepared native
      // generation, even if another query has since changed the model catalog.
      const iterator = inRequest(() => call.stream(toNativeOptions(options, model, signal, scope, credentialIdentity))[Symbol.asyncIterator]());
      let exhausted = false;
      try {
        while (true) {
          const step = await waitFor(inRequest(() => iterator.next()), signal);
          if (step.done) { exhausted = true; return; }
          abort(signal);
          const chunk = step.value;
          if (chunk.type === "finish" && chunk.reason?.kind === "error") {
            const failure = guardFailure(chunk.reason.failure?.message);
            if (failure) throw failure;
          }
          if (chunk.type === "finish" && (chunk.replayState !== undefined || scope !== undefined)) {
            yield { ...chunk, replayState: { kind: "copilot-account", version: 1, accountId, credentialIdentity,
              ...(chunk.replayState === undefined ? {} : { native: clone(chunk.replayState) }),
              ...(scope === undefined ? {} : { cache: clone(scope.cacheMeta) }) } };
          } else yield chunk;
        }
      } catch (error) {
        throw guardFailure(error?.message) ?? error;
      } finally {
        // A provider ignoring abort must not keep the caller waiting on return().
        if (!exhausted && iterator.return !== undefined) {
          try { void Promise.resolve(inRequest(() => iterator.return())).catch(() => {}); } catch { /* preserve original outcome */ }
        }
      }
    }
    async *stream(options) {
      const call = await this.prepareCall(options.provider, options.model, options.signal);
      yield* call.stream(options);
    }
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle.abort(fail("Copilot account route is disabled", "ACCOUNT_UNAVAILABLE"));
    }
  }
  const adapter = new AccountAdapter();
  Object.defineProperties(adapter, { accountId: { value: accountId, enumerable: true },
    routeId: { value: routeId, enumerable: true }, credentialStore: { value: credentialStore } });
  return adapter;
}
