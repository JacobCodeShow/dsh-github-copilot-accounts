// A narrow creation-time correction for NEW native seeded fork children only.
// It appends released model/selection via AgentModel; no history/header is edited.
const ref = (value) => value !== null && (typeof value === "object" || typeof value === "function");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const abort = (signal) => { signal?.throwIfAborted(); };
const SERVICES = ["agents", "sessions", "llm", "sessionQuery"];
export class SubagentAccountPolicyError extends Error {
  constructor(message, code) { super(message); this.name = "SubagentAccountPolicyError"; this.code = code; }
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
 * Return an awaited agent/created listener. context must be the feature's native
 * service scope. Mount with context.on('agent/created', listener); do not patch
 * core methods or replace providers. ownsRoute(provider) must return true only
 * for this feature registry's enabled account route. originalSymbol should be
 * Cordis's exported symbols.original (the default is that public global key).
 *
 * Captured child options + its first current-lifecycle own fork descriptor must
 * agree. Ordinary UI prefix forks, resume, historical descriptors, other service
 * scopes/backends and unbound routes are untouched. A matched alias whose route
 * disappeared fails closed, never falling back to the copied seed's old route.
 */
export function createSubagentAccountPolicy({ context, isAccountRoute, ownsRoute,
  forkProviderName = "fork", originalSymbol = Symbol.for("cordis.original"),
  LlmError = SubagentAccountPolicyError } = {}) {
  const errors = new WeakSet();
  const fail = (message, code) => { const error = new LlmError(message, code); errors.add(error); return error; };
  if (typeof context?.get !== "function" || typeof isAccountRoute !== "function" || typeof ownsRoute !== "function"
    || typeof forkProviderName !== "string" || forkProviderName === "" || typeof originalSymbol !== "symbol") {
    throw fail("Native child account policy integrations are unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
  }
  const original = (value) => {
    const seen = new Set();
    while (ref(value) && !seen.has(value)) {
      seen.add(value);
      const next = value[originalSymbol];
      if (!ref(next) || next === value) return value;
      value = next;
    }
    return value;
  };
  let expected;
  try { expected = Object.fromEntries(SERVICES.map((name) => [name, original(context.get(name))])); }
  catch { throw fail("Native child account service scope is unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE"); }
  if (typeof expected.agents?.get !== "function" || typeof expected.agents?.isOwnedBy !== "function"
    || typeof expected.sessions?.get !== "function" || typeof expected.llm?.resolveCallConfig !== "function"
    || typeof expected.sessionQuery?.observeSession !== "function") {
    throw fail("Native child account service scope is unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
  }
  const sameScope = (agent) => {
    try { return typeof agent.ctx?.get === "function" && SERVICES.every((name) =>
      original(context.get(name)) === expected[name] && original(agent.ctx.get(name)) === expected[name]); }
    catch { return false; }
  };
  const live = (agent, signal) => {
    abort(signal);
    if (!sameScope(agent) || expected.agents.get(agent.id) !== agent
      || expected.sessions.get(agent.session.id) !== agent.session) {
      throw fail("Native child account scope is no longer available", "ACCOUNT_UNAVAILABLE");
    }
  };
  const requireRoute = async (provider, signal) => {
    abort(signal);
    let owned;
    try { owned = await waitFor(Promise.resolve().then(() => ownsRoute(provider)), signal); }
    catch { abort(signal); throw fail("Captured child account route is unavailable", "ACCOUNT_UNAVAILABLE"); }
    abort(signal);
    if (owned !== true) throw fail("Captured child account route is unavailable", "ACCOUNT_UNAVAILABLE");
  };
  return async function bindNewNativeForkAccount({ agent, source, signal } = {}) {
    const session = agent?.session, creation = session?.header;
    if (source !== "startup" || creation?.origin !== "subagent" || creation.isSeeded !== true
      || typeof agent?.model?.select !== "function" || !sameScope(agent)) return false;
    const options = agent.options ?? {};
    const selection = Object.freeze({ provider: options.provider, model: options.model,
      ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }) });
    let matched;
    try { matched = isAccountRoute(selection.provider); }
    catch { throw fail("Invalid captured child account route", "ACCOUNT_CHILD_BINDING_INVALID"); }
    if (matched !== true) return false;
    live(agent, signal);
    // Runtime ownership, not a forged/durable parentSession string, proves this
    // is a native child rather than a top-level prefix fork or resumed root.
    if (expected.agents.isOwnedBy(agent.id, undefined)) return false;
    const parent = typeof creation.parentSession === "string" ? expected.agents.get(creation.parentSession) : undefined;
    if (!parent || !expected.agents.isOwnedBy(agent.id, parent)) {
      throw fail("Captured native child parent is unavailable", "ACCOUNT_UNAVAILABLE");
    }
    const parentLive = () => {
      if (expected.agents.get(parent.id) !== parent || !expected.agents.isOwnedBy(agent.id, parent)) {
        throw fail("Captured native child parent is no longer available", "ACCOUNT_UNAVAILABLE");
      }
    };
    const inherited = session.inheritedEventCount, first = session.firstLifecycleSeq;
    if (!Number.isSafeInteger(inherited) || inherited < 0 || !Number.isSafeInteger(first) || first < inherited) {
      throw fail("Native child lifecycle boundary is unsupported", "ACCOUNT_CHILD_BINDING_INVALID");
    }
    const releaseObservation = (value) => {
      try {
        const dispose = value?.[Symbol.dispose] ?? value?.[Symbol.asyncDispose];
        if (typeof dispose === "function") void Promise.resolve(dispose.call(value)).catch(() => {});
      } catch { /* preserve policy outcome, no private cleanup diagnostics */ }
    };
    let observation;
    try {
      const pending = Promise.resolve().then(() => context.get("sessionQuery").observeSession(session.id,
        { projectionMode: "none", ...(signal === undefined ? {} : { signal }) }));
      try { observation = await waitFor(pending, signal); }
      catch (error) {
        // If cancellation wins before adoption, still release a late lease.
        void pending.then(releaseObservation).catch(() => {});
        throw error;
      }
      live(agent, signal); parentLive();
      if (observation?.source !== "live" || observation.header?.id !== session.id
        || observation.header.createdAt !== creation.createdAt || observation.inheritedEventCount !== inherited
        || !Array.isArray(observation.events)) {
        throw fail("Native child observation is inconsistent", "ACCOUNT_CHILD_BINDING_INVALID");
      }
      // Match the FIRST own descriptor (native cold-resume authority), never an
      // inherited parent's descriptor or a later attempted historical rewrite.
      const descriptor = observation.events.find((event) => event.seq >= inherited && event.type === "subagent/descriptor");
      if (!descriptor || descriptor.seq < first) return false;
      if (!Number.isSafeInteger(descriptor.seq)) throw fail("Invalid native child descriptor boundary", "ACCOUNT_CHILD_BINDING_INVALID");
      const data = descriptor.data;
      if (!object(data) || data.provider !== forkProviderName) return false;
      if (data.version !== 3 || data.mode !== "continuable" || typeof selection.model !== "string" || selection.model === ""
        || data.agentProvider !== selection.provider || data.agentModel !== selection.model
        || data.agentReasoningEffort !== selection.reasoningEffort) {
        throw fail("Native fork descriptor does not match captured account options", "ACCOUNT_CHILD_BINDING_INVALID");
      }
      // Correct inherited fallback state only. A released child-owned choice or
      // request already made in this lifecycle is more specific than constructor
      // fallback options (and may be an explicit setup/user override).
      if (observation.events.some((event) => event.seq >= inherited && event.seq >= first
        && (event.type === "model/selection" || event.type === "request/header"))) return false;
      await requireRoute(selection.provider, signal);
      const resolved = await waitFor(Promise.resolve().then(() => context.get("llm").resolveCallConfig(selection, signal)), signal);
      live(agent, signal); parentLive();
      if (resolved?.provider !== selection.provider || resolved.model !== selection.model) {
        throw fail("Captured native child account route changed during validation", "ACCOUNT_CHILD_BINDING_INVALID");
      }
      await requireRoute(selection.provider, signal);
      live(agent, signal); parentLive();
      const before = session.seq;
      agent.model.select(selection);
      return session.seq !== before;
    } catch (error) {
      abort(signal);
      // Only fixed policy messages cross this boundary; native lookup/query
      // diagnostics can contain URLs or unrelated configuration details.
      if (errors.has(error)) throw error;
      throw fail("Captured native fork account could not be validated", "ACCOUNT_UNAVAILABLE");
    } finally {
      releaseObservation(observation);
    }
  };
}
