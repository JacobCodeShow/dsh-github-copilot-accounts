import { isAccountRoute, GLOBAL_COPILOT_ROUTE } from "./account-route-id.mjs";

export class SessionAccountError extends Error {
  constructor(message, code, status = 409) { super(message); this.name = "SessionAccountError"; this.code = code; this.status = status; }
}
const bad = (message) => new SessionAccountError(message, "INVALID_ARGUMENT", 400);
const selectionOf = (value) => value == null ? undefined : ({
  provider: value.provider, model: value.model,
  ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }),
});
const sameSelection = (a, b) => a?.provider === b?.provider && a?.model === b?.model && a?.reasoningEffort === b?.reasoningEffort;

/**
 * Session-local binding coordinator. Authorization is REQUIRED, never inferred
 * from a caller-supplied account/session id. The transport must supply its real
 * caller policy. Stock selectModel owns writer/catalog/image admission; a tested
 * policy scope suppresses its unrelated future-default save.
 */
export function createSessionAccountController({ sessionController, llm, registry, policy, authorizeSession }) {
  if (typeof sessionController?.resolveAgent !== "function" || typeof sessionController?.selectModel !== "function"
    || typeof llm?.listModels !== "function" || typeof llm?.resolveCallConfig !== "function"
    || typeof registry?.account !== "function" || typeof registry?.accountForRoute !== "function"
    || typeof authorizeSession !== "function") throw new TypeError("Session binding requires controller, registry, LLM and explicit authorization");
  const queues = new Map();
  const requirePolicy = () => {
    let protectedController = false;
    try { protectedController = policy?.isControllerProtected?.() === true; } catch { /* fail closed */ }
    if (policy?.version !== 1 || policy.active === false || !protectedController || typeof policy.withSessionSelectionOnly !== "function") {
      throw new SessionAccountError("Session account default policy is unavailable", "POLICY_UNAVAILABLE", 503);
    }
  };
  const validateId = (id) => { if (typeof id !== "string" || id.length === 0 || id.length > 256) throw bad("Session id required"); };
  const allowed = async (id, operation) => {
    validateId(id);
    if (await authorizeSession(id, operation) !== true) throw new SessionAccountError("Session access denied", "SESSION_FORBIDDEN", 403);
  };
  const resolve = async (id) => {
    const result = await sessionController.resolveAgent(id);
    if (result?.error !== undefined) {
      const code = typeof result.error.code === "string" ? result.error.code : "SESSION_UNAVAILABLE";
      throw new SessionAccountError("Session is not writable by this runtime", code);
    }
    const agent = result?.agent;
    if (agent?.session?.id !== id || typeof agent.model?.current !== "function") {
      throw new SessionAccountError("Session is unavailable", "SESSION_UNAVAILABLE", 404);
    }
    return agent;
  };
  const routeState = (selection) => {
    if (selection === undefined) return { mode: "inactive", accountId: null, available: false };
    if (selection.provider === "github-copilot" || selection.provider === GLOBAL_COPILOT_ROUTE) return { ...selection, mode: "global", accountId: null, available: true };
    if (!isAccountRoute(selection.provider)) return { ...selection, mode: "inactive", accountId: null, available: false };
    const account = registry.accountForRoute(selection.provider);
    return { ...selection, mode: "bound", accountId: account?.id ?? null, available: account !== undefined && account.available !== false && account.routeAvailable !== false,
      ...(account === undefined ? {} : { account }) };
  };
  const stateOf = (id, agent) => ({
    sessionId: id,
    running: agent.status === "running",
    next: routeState(selectionOf(agent.model.current())),
    lastUsed: routeState(selectionOf(agent.session.requestHeader?.()?.config)),
  });
  const ensureIdle = (agent) => {
    if (agent.status !== "idle") throw new SessionAccountError("Wait for the Session to become idle before changing account", "SESSION_BUSY");
  };
  const read = async (request = {}) => {
    const { sessionId } = request ?? {};
    requirePolicy();
    await allowed(sessionId, "read");
    return stateOf(sessionId, await resolve(sessionId));
  };
  return {
    read,
    async bind(request) {
      requirePolicy();
      const { sessionId, accountId, expected } = request ?? {};
      await allowed(sessionId, "write");
      if (accountId !== null && (typeof accountId !== "string" || accountId.length === 0)) throw bad("Account id or explicit null required");
      if (expected !== undefined && (typeof expected?.provider !== "string" || typeof expected?.model !== "string")) throw bad("Invalid expected model selection");
      const previous = queues.get(sessionId) ?? Promise.resolve();
      const operation = previous.then(async () => {
        requirePolicy();
        await allowed(sessionId, "write");
        const agent = await resolve(sessionId);
        ensureIdle(agent);
        const before = selectionOf(agent.model.current());
        if (before === undefined || before.provider !== "github-copilot" && before.provider !== GLOBAL_COPILOT_ROUTE && !isAccountRoute(before.provider)) {
          throw new SessionAccountError("Select a Copilot model before binding an account", "NOT_COPILOT_SESSION");
        }
        if (expected !== undefined && !sameSelection(before, expected)) {
          throw new SessionAccountError("Session model changed; reload account choices", "STALE_SELECTION");
        }
        const account = accountId === null ? undefined : registry.account(accountId);
        if (accountId !== null && account === undefined) throw new SessionAccountError("Selected account is unavailable", "ACCOUNT_UNAVAILABLE", 404);
        const selected = { ...before, provider: accountId === null ? GLOBAL_COPILOT_ROUTE : account.routeId };
        let offered;
        try { offered = await llm.listModels(selected.provider); }
        catch (error) {
          if (error?.code === "ACCOUNT_COMPACTION_RESTART_REQUIRED") throw new SessionAccountError("Restart DSH to apply compaction policy for this account", "ACCOUNT_COMPACTION_RESTART_REQUIRED", 409);
          throw new SessionAccountError("Selected account model catalog is unavailable", "ACCOUNT_MODEL_UNAVAILABLE");
        }
        if (!Array.isArray(offered) || !offered.some((model) => model.id === selected.model)) {
          throw new SessionAccountError("Selected account does not offer the current model", "ACCOUNT_MODEL_UNAVAILABLE");
        }
        // Validate without substituting an effort/model or choosing a fallback.
        try { await llm.resolveCallConfig(selected); }
        catch { throw new SessionAccountError("Selected account does not support the current model controls", "ACCOUNT_MODEL_UNAVAILABLE"); }
        requirePolicy();
        await allowed(sessionId, "write");
        ensureIdle(agent);
        if (!sameSelection(before, selectionOf(agent.model.current()))) {
          throw new SessionAccountError("Session model changed; reload account choices", "STALE_SELECTION");
        }
        if (accountId !== null && registry.account(accountId)?.routeId !== selected.provider) {
          throw new SessionAccountError("Selected account was removed", "ACCOUNT_UNAVAILABLE", 404);
        }
        // Reuse the stock operation's writer/catalog/image admission serialization.
        // A stream beginning during its async admission stays on its captured old
        // route; native selection only affects a later prepared step, never tokens
        // or credentials of a request already in flight.
        const result = await policy.withSessionSelectionOnly(() => sessionController.selectModel({ sessionId, ...selected }));
        if (!sameSelection(result?.selected, selected)) throw new SessionAccountError("Unexpected model selection response", "SELECTION_FAILED", 502);
        return { accepted: selectionOf(result.selected), ...stateOf(sessionId, agent) };
      });
      const settled = operation.catch(() => {});
      queues.set(sessionId, settled);
      settled.finally(() => { if (queues.get(sessionId) === settled) queues.delete(sessionId); });
      return operation;
    },
  };
}
