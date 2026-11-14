// Stable public account route over explicit, eagerly compiled profile generations.
// This module performs no config lookup, credential access, registration, or HTTP.
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const object = (value) => value !== null && typeof value === "object";
const ROUTE = /^[a-z][a-z0-9-]*$/;
const PROFILE_MESSAGE = "Configured Copilot account profile is unavailable";

export class ProfiledAccountError extends Error {
  constructor(message, code) { super(message); this.name = "ProfiledAccountError"; this.code = code; }
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
 * Initialize before registering this proxy with LLM. createDelegate(profile) must
 * build an accountAdapter bound to exactly routeId/accountId; never a shared route.
 * onPublish is synchronous and runs on UPDATES only, with the candidate already
 * current so registration.replace() captures that generation's retry/label facts.
 * The callback must publish atomically (as the LLM registration API does).
 *
 * updateProfile returns true for publication, false for superseded builds; latest
 * failures reject sanitized ACCOUNT_PROFILE_INVALID and block NEW request methods.
 * Prepared/started old calls retain their captured delegate until lifecycle revoke.
 * Old published delegates are intentionally retained until dispose() in v1.
 */
export async function createProfiledAccountAdapter({ LlmAdapter, createDelegate, initialProfile,
  routeId, accountId, onPublish, LlmError = ProfiledAccountError } = {}) {
  const fail = (message, code) => new LlmError(message, code);
  const profileError = () => fail(PROFILE_MESSAGE, "ACCOUNT_PROFILE_INVALID");
  const unavailable = () => fail("Copilot account route is disabled", "ACCOUNT_UNAVAILABLE");
  if (typeof LlmAdapter !== "function" || typeof createDelegate !== "function") throw fail("Account profile integrations are unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
  if (typeof routeId !== "string" || !ROUTE.test(routeId) || routeId === "github-copilot"
    || typeof accountId !== "string" || accountId === "") throw fail("Invalid account route identity", "INVALID_ACCOUNT_ROUTE");
  if (onPublish !== undefined && typeof onPublish !== "function") throw fail("Invalid profile publication callback", "ACCOUNT_RUNTIME_UNAVAILABLE");
  const lifecycle = new AbortController(), published = new Set(), revoked = new WeakSet();
  let current, activeGeneration = 0, latestStarted = 0, blocked = false, disposed = false, cleanupPromise;
  const signalFor = (...signals) => {
    const values = [...new Set([lifecycle.signal, ...signals].filter(Boolean))];
    return values.length === 1 ? values[0] : AbortSignal.any(values);
  };
  const owned = (candidate) => {
    try { return object(candidate) && candidate.accountId === accountId && candidate.routeId === routeId; }
    catch { return false; }
  };
  const disposeCandidate = (candidate, includePublished = false) => {
    // Never revoke another account's already-live adapter if a buggy builder
    // returned it. Foreign identity is rejected, not claimed as our resource.
    if (!owned(candidate) || revoked.has(candidate) || (!includePublished && published.has(candidate))) return Promise.resolve();
    revoked.add(candidate);
    try { return Promise.resolve(candidate.dispose?.()).catch(() => {}); }
    catch { return Promise.resolve(); } // Revoke all remaining generations, no private diagnostics.
  };
  const validate = (candidate) => {
    if (!owned(candidate) || ["providerInfo", "listModels", "resolveModel", "prepareCall", "stream", "dispose"].some((method) => typeof candidate[method] !== "function")) throw profileError();
    const info = candidate.providerInfo(routeId);
    if (!object(info) || info.id !== routeId) throw profileError();
    return candidate;
  };
  const ownRoute = (provider) => {
    if (provider !== routeId) throw fail("Profiled account adapter does not own this route", "NO_ADAPTER");
    if (disposed) throw unavailable();
  };
  const capture = (provider, request = false) => {
    ownRoute(provider);
    if (!current || (request && blocked)) throw profileError();
    if (!owned(current)) throw profileError();
    return current;
  };
  const publicModel = (model, expected) => {
    if (!object(model) || model.provider !== routeId || typeof model.id !== "string" || model.id === ""
      || (expected !== undefined && model.id !== expected)) throw profileError();
    try { return copy(model); } catch { throw profileError(); }
  };
  async function* managedStream(source, signal) {
    signal.throwIfAborted();
    const iterator = source[Symbol.asyncIterator]();
    let exhausted = false;
    try {
      while (true) {
        const step = await waitFor(iterator.next(), signal);
        if (step.done) { exhausted = true; return; }
        signal.throwIfAborted();
        yield step.value; // Account/replay envelope must remain exactly the delegate's.
      }
    } finally {
      if (!exhausted && iterator.return !== undefined) {
        try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* preserve original outcome */ }
      }
    }
  }
  let proxy;
  const build = (profile, initial = false) => {
    const ticket = ++latestStarted;
    const operation = (async () => {
      let candidate;
      try {
        // Detach before the first await: edits to the caller's config object
        // cannot change the contents of an already-started compilation.
        const snapshot = copy(profile);
        candidate = await createDelegate(snapshot);
        if (disposed || ticket !== latestStarted) { await disposeCandidate(candidate); return false; }
        validate(candidate);
        const previous = current, previousGeneration = activeGeneration, previousBlocked = blocked;
        const alreadyPublished = published.has(candidate);
        current = candidate; activeGeneration = ticket; blocked = false;
        published.add(candidate); // dispose() can run reentrantly in onPublish.
        try {
          if (!initial && onPublish !== undefined) {
            const result = onPublish(Object.freeze({ adapter: proxy, routeId, accountId, generation: ticket }));
            if (result && typeof result.then === "function") {
              void Promise.resolve(result).catch(() => {});
              throw profileError(); // An async registry callback cannot be rolled back atomically.
            }
          }
        } catch {
          if (current === candidate) { current = previous; activeGeneration = previousGeneration; blocked = previousBlocked; }
          if (!alreadyPublished) published.delete(candidate);
          throw profileError();
        }
        return true;
      } catch {
        // Obsolete failures cannot poison a newer valid/pending configuration.
        if (disposed || ticket !== latestStarted) { await disposeCandidate(candidate); return false; }
        blocked = true;
        await disposeCandidate(candidate);
        if (disposed || ticket !== latestStarted) return false;
        throw profileError();
      }
    })();
    return waitFor(operation, lifecycle.signal);
  };
  class ProfiledAdapter extends LlmAdapter {
    providerInfo(provider) {
      const delegate = capture(provider);
      const info = delegate.providerInfo(provider);
      if (!object(info) || info.id !== routeId) throw profileError();
      return copy(info);
    }
    providerRetryPolicy(provider) { return capture(provider).providerRetryPolicy?.(provider); }
    imageRequestPricing(provider, model) { return capture(provider).imageRequestPricing?.(provider, model); }
    imageRequestTarget(provider, model, image) {
      const delegate = capture(provider);
      return typeof delegate.imageRequestTarget === "function" ? delegate.imageRequestTarget(provider, model, image)
        : { width: image.width, height: image.height, maxBytes: image.bytes };
    }
    async listModels(provider) {
      const delegate = capture(provider, true); // MUST precede any await.
      const models = await waitFor(delegate.listModels(provider), lifecycle.signal);
      ownRoute(provider);
      if (!Array.isArray(models)) throw profileError();
      return models.map((model) => publicModel(model));
    }
    async resolveModel(provider, model, signal) {
      const delegate = capture(provider, true); // Captures retry/metadata generation.
      signal = signalFor(signal); signal.throwIfAborted();
      const result = await waitFor(delegate.resolveModel(provider, model, signal), signal);
      ownRoute(provider);
      return publicModel(result, model);
    }
    async prepareCall(provider, model, signal) {
      const delegate = capture(provider, true);
      signal = signalFor(signal); signal.throwIfAborted();
      const call = await waitFor(delegate.prepareCall(provider, model, signal), signal);
      ownRoute(provider);
      if (typeof call?.stream !== "function") throw profileError();
      const metadata = publicModel(call.model, model);
      return { model: metadata, stream: (options) => {
        ownRoute(options.provider); // Deliberately do not consult latest blocked state.
        if (options.model !== model) throw fail("Prepared account model does not match request", "PREPARED_CALL_MISMATCH");
        const requestSignal = signalFor(signal, options.signal); requestSignal.throwIfAborted();
        return managedStream(call.stream({ ...options, signal: requestSignal }), requestSignal);
      } };
    }
    stream(options) {
      const delegate = capture(options.provider, true); // Capture on method call, not first iterator.next().
      const signal = signalFor(options.signal); signal.throwIfAborted();
      return managedStream(delegate.stream({ ...options, signal }), signal);
    }
    async updateProfile(profile) {
      ownRoute(routeId);
      return build(profile);
    }
    dispose() {
      if (disposed) return cleanupPromise;
      disposed = true;
      lifecycle.abort(unavailable());
      const tasks = [...published].map((candidate) => disposeCandidate(candidate, true));
      published.clear();
      cleanupPromise = Promise.all(tasks).then(() => {});
      // Do not wait on builders which may still be pending: their eventual
      // completions see disposed and clean their owned candidate immediately.
      return cleanupPromise;
    }
  }
  proxy = new ProfiledAdapter();
  Object.defineProperties(proxy, {
    routeId: { value: routeId, enumerable: true }, accountId: { value: accountId, enumerable: true },
    generation: { get: () => activeGeneration },
    profileError: { get: () => blocked ? { code: "ACCOUNT_PROFILE_INVALID", message: PROFILE_MESSAGE } : undefined },
  });
  try { await build(initialProfile, true); return proxy; }
  catch (error) { await proxy.dispose(); throw error; }
}
