import { GLOBAL_COPILOT_ROUTE, isAccountRoute } from "./account-route-id.mjs";

export class CopilotRouteHubError extends Error {
  constructor(message, code) { super(message); this.name = "CopilotRouteHubError"; this.code = code; }
}

// One public adapter OWNS every managed logical route. DSH's normative replay
// boundary retains state only within one owning adapter; distinct owners would
// erase even valid same-account replay before our provenance validator sees it.
// Account delegates remain isolated. Shared ownership NEVER means shared auth.
export function createCopilotRouteHub({ LlmAdapter, llm, LlmError = CopilotRouteHubError, assertRoute = () => {} }) {
  if (typeof LlmAdapter !== "function" || typeof llm?.registerAdapter !== "function") throw new TypeError("Copilot route hub runtime required");
  const fail = (message, code) => new LlmError(message, code);
  let delegates = new Map(), registration, closed = false;
  const own = (provider) => {
    if (closed) throw fail("Copilot routes are unavailable", "ACCOUNT_UNAVAILABLE");
    const delegate = delegates.get(provider);
    if (!delegate) throw fail("Copilot route is unavailable", "NO_ADAPTER");
    return delegate;
  };
  class CopilotHubAdapter extends LlmAdapter {
    providerInfo(provider) { return own(provider).providerInfo(provider); }
    providerRetryPolicy(provider) { return own(provider).providerRetryPolicy?.(provider); }
    imageRequestPricing(provider, model) { const delegate = own(provider); assertRoute(provider, model); return delegate.imageRequestPricing?.(provider, model); }
    imageRequestTarget(provider, model, image) { const delegate = own(provider); assertRoute(provider, model); return delegate.imageRequestTarget(provider, model, image); }
    async listModels(provider) { const delegate = own(provider); const models = await delegate.listModels(provider); for (const model of models) assertRoute(provider, model.id); return models; }
    resolveModel(provider, model, signal) { const delegate = own(provider); assertRoute(provider, model); return delegate.resolveModel(provider, model, signal); }
    prepareCall(provider, model, signal) { const delegate = own(provider); assertRoute(provider, model); return delegate.prepareCall(provider, model, signal); }
    stream(options) { const delegate = own(options.provider); assertRoute(options.provider, options.model); return delegate.stream(options); }
  }
  const adapter = new CopilotHubAdapter();
  const commit = (next) => {
    if (closed) throw fail("Copilot routes are unavailable", "ACCOUNT_UNAVAILABLE");
    const previous = delegates;
    delegates = next; // Metadata preparation reads the exact candidate map.
    try {
      if (registration === undefined && next.size > 0) registration = llm.registerAdapter([...next.keys()], adapter);
      else if (registration !== undefined && next.size > 0) registration.replace([...next.keys()]);
      else if (registration !== undefined) { registration(); registration = undefined; }
    } catch (error) { delegates = previous; throw error; }
  };
  return Object.freeze({
    adapter,
    get: (provider) => closed ? undefined : delegates.get(provider),
    has: (provider) => !closed && delegates.has(provider),
    routes: () => closed ? [] : [...delegates.keys()],
    registerAdapter(providers, delegate) {
      if (closed) throw fail("Copilot routes are unavailable", "ACCOUNT_UNAVAILABLE");
      if (!Array.isArray(providers) || providers.length === 0 || !delegate) throw fail("Invalid Copilot route registration", "INVALID_ADAPTER");
      const owned = new Set(); let released = false;
      const replace = (nextProviders) => {
        if (released || closed) throw fail("Copilot route registration is disposed", "REGISTRATION_DISPOSED");
        if (!Array.isArray(nextProviders)) throw fail("Invalid Copilot route registration", "INVALID_ADAPTER");
        const unique = new Set();
        for (const id of nextProviders) {
          if (!(id === GLOBAL_COPILOT_ROUTE || isAccountRoute(id))) throw fail("Invalid managed Copilot route", "INVALID_ADAPTER");
          if (unique.has(id) || delegates.has(id) && !owned.has(id)) throw fail("Copilot route already registered", "DUPLICATE_ADAPTER");
          const info = delegate.providerInfo(id);
          if (info?.id !== id) throw fail("Copilot route identity mismatch", "INVALID_ADAPTER");
          unique.add(id);
        }
        const next = new Map(delegates);
        for (const id of owned) if (next.get(id) === delegate) next.delete(id);
        for (const id of unique) next.set(id, delegate);
        commit(next);
        owned.clear(); for (const id of unique) owned.add(id);
      };
      replace(providers);
      const dispose = () => {
        if (released) return;
        if (closed) { released = true; owned.clear(); return; }
        const next = new Map(delegates);
        for (const id of owned) if (next.get(id) === delegate) next.delete(id);
        commit(next); released = true; owned.clear();
      };
      dispose.replace = replace;
      return dispose;
    },
    dispose() {
      if (closed) return;
      closed = true; delegates.clear();
      try { registration?.(); } finally { registration = undefined; }
      // Delegate/account lifecycle belongs to the registry; do not revoke an
      // unrelated account or a reused delegate just to withdraw this hub.
    },
  });
}
