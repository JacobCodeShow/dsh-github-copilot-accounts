// Host-only policy facade. The original global default-model service remains
// untouched; selected consumers use this policy in a named isolation realm.
import { AsyncLocalStorage } from "node:async_hooks";
import { isAccountRoute, normalizeDefaultSelection, GLOBAL_COPILOT_ROUTE } from "./account-route-id.mjs";
import { createSessionLlmCatalogPolicy } from "./session-catalog-policy.mjs";

export const name = "copilot-default-model-policy";
// Do not inject our own isolated provision; the backing dependency is injected
// from the public parent scope below, avoiding a private self-dependency cycle.
export const inject = [];
const SERVICE = "agentDefaultModel";
const CONSUMER_SERVICES = [SERVICE, "llm"];
export const DEFAULT_MODEL_POLICY_SERVICE = "copilotDefaultModelPolicy";
const sessionSelectionScope = new AsyncLocalStorage();
const RESTART_BOUNDARIES = Symbol.for("dsh-github-copilot-accounts.default-model.restart-boundaries.v2");
const CONTROLLER_MODULE = "@deepseek-ai/dsh-api-session-controller";

export function createControllerProtectionGuard(ctx, Context, controllerModuleName = CONTROLLER_MODULE) {
  const entry = ctx.fiber?.entry;
  const tree = entry?.parent?.tree;
  const scopes = CONSUMER_SERVICES.map((service) => ({ service, realmName: entry?.options?.isolate?.[service], label: ctx[Context.isolate]?.[service] }));
  return () => {
    try {
      if (scopes.some(({realmName,label}) => typeof realmName !== "string" || typeof label !== "symbol")) return false;
      const target = tree.resolve("session-controller");
      return target.parent.tree === tree && target.options.name === controllerModuleName
        && scopes.every(({service,realmName,label}) => target.options.isolate?.[service] === realmName && target.ctx[Context.isolate]?.[service] === label);
    } catch { return false; } // Missing/different nested EntryTree is unsupported.
  };
}

export class DefaultModelRestartRequiredError extends Error {
  constructor() {
    super("Copilot session-account policy changes require a full DSH restart; warm controller fallback to the global default is blocked");
    this.name = "DefaultModelRestartRequiredError";
    this.code = "COPILOT_RESTART_REQUIRED";
  }
}

// This fail-closed boundary is deliberately ROOT-owned until process shutdown.
// A policy fiber may disappear before the controller is reconciled; a listener
// owned by that fiber would then vanish too early and permit a pending stock
// selectModel() to fall through to the original global saver.
export function installRestartBoundary(ctx, Context) {
  const entry = ctx.fiber?.entry;
  const tree = entry?.parent?.tree;
  const scopes = CONSUMER_SERVICES.map((service) => ({service,realmName:entry?.options?.isolate?.[service],label:ctx[Context.isolate]?.[service]}));
  if (tree === undefined || scopes.some(({realmName,label}) => typeof realmName !== "string" || typeof label !== "symbol")) {
    throw new Error("Copilot restart boundary requires a named Loader policy realm");
  }
  const root = ctx.root;
  let state = root[RESTART_BOUNDARIES];
  if (state === undefined) {
    state = { trees: new Map() };
    root[RESTART_BOUNDARIES] = state;
    root.on("loader/patch-context", (target, next) => {
      const boundary = state.trees.get(target.parent?.tree)?.get(target.options?.id);
      if (boundary !== undefined && [...boundary.services].some(([service,scope]) =>
        scope.labels.has(target.ctx[Context.isolate]?.[service]) && target.options.isolate?.[service] !== scope.realmName)) {
        throw new DefaultModelRestartRequiredError();
      }
      return next();
    }, { prepend: true, global: true });
  }
  let boundaries = state.trees.get(tree);
  if (boundaries === undefined) state.trees.set(tree, boundaries = new Map());
  let boundary = boundaries.get("session-controller");
  if (boundary === undefined) boundaries.set("session-controller", boundary = { services: new Map() });
  for (const {service,realmName,label} of scopes) {
    let scope = boundary.services.get(service);
    if (scope === undefined) boundary.services.set(service, scope = {realmName,labels:new Set()});
    if (scope.realmName !== realmName) throw new DefaultModelRestartRequiredError();
    scope.labels.add(label);
  }
}

// The stock session controller also saves defaults. Explicit bind/unbind calls
// use this scope so even a native-route unbind does not change future defaults.
export function withSessionSelectionOnly(operation) {
  if (typeof operation !== "function") throw new TypeError("Session selection operation required");
  return sessionSelectionScope.run(true, operation);
}

// Dependency-injected for unit tests. No methods on the backing service change.
export function createDefaultModelPolicy(backing, { isManagedReady = () => false } = {}) {
  if (typeof backing?.currentSelection !== "function" || typeof backing?.saveSelection !== "function" || typeof isManagedReady !== "function") {
    throw new TypeError("Default model backing service required");
  }
  return Object.freeze({
    currentSelection() {
      // Repair an old alias only in the returned fallback, not in saved config.
      const stored = normalizeDefaultSelection(backing.currentSelection());
      const fallback = stored.provider === GLOBAL_COPILOT_ROUTE ? { ...stored, provider: "github-copilot" } : stored;
      return isManagedReady() === true && fallback.provider === "github-copilot" ? { ...fallback, provider: GLOBAL_COPILOT_ROUTE } : fallback;
    },
    saveSelection(selection) {
      // A stock model-picker change on an account-bound Session is local too:
      // neither its account NOR model/effort becomes the future global default.
      if (sessionSelectionScope.getStore() === true || isAccountRoute(selection?.provider)) return Promise.resolve();
      // Retain the native service's own validation, formatting and ordered saves.
      return backing.saveSelection(selection?.provider === GLOBAL_COPILOT_ROUTE ? { ...selection, provider: "github-copilot" } : selection);
    },
  });
}

// A retained host reference must not start a bind after policy disposal. This
// marker is owned by the same injected child as the private facade.
export function createDefaultModelPolicyMarker(isProtected = () => false) {
  let active = true;
  const protectedNow = () => {
    try { return active && isProtected() === true; } catch { return false; }
  };
  const marker = Object.freeze({
    get version() { return active ? 1 : undefined; },
    get active() { return active; },
    isControllerProtected: protectedNow,
    withSessionSelectionOnly(operation) {
      if (!protectedNow()) throw new Error("Copilot default-model policy is unavailable for this Session controller");
      return withSessionSelectionOnly(operation);
    },
  });
  return { marker, deactivate() { active = false; } };
}

// Context is passed explicitly so tests can exercise the exact mounting logic
// without importing a runtime peer or touching a running application's context.
export function installDefaultModelPolicy(ctx, Context, { controllerModuleName = CONTROLLER_MODULE } = {}) {
  const parent = ctx.fiber?.entry?.parent?.ctx;
  const parentMap = parent?.[Context.isolate];
  const labels = Object.fromEntries(CONSUMER_SERVICES.map((service) => [service, ctx[Context.isolate]?.[service]]));
  if (parentMap === undefined || CONSUMER_SERVICES.some((service) => typeof labels[service] !== "symbol" || parentMap[service] === labels[service])) {
    throw new Error("Copilot default-model policy requires a separate named consumer realm");
  }
  // Context.isolate maps are public Context metadata. A derived context shares
  // the parent's map (without changing it), so a not-yet-mounted native service
  // can publish its public label later and satisfy this normal injection.
  const publicContext = ctx.extend({ fiber: ctx.fiber, [Context.isolate]: parentMap });
  return publicContext.inject(CONSUMER_SERVICES, (bound) => {
    const isManagedReady = () => {
      try { const managed = bound.get("copilotManagedDefault"); return managed?.version === 1 && typeof managed.isReady === "function" && managed.isReady() === true; }
      catch { return false; }
    };
    const policy = createDefaultModelPolicy(bound.agentDefaultModel, { isManagedReady });
    const catalog = createSessionLlmCatalogPolicy(bound.llm, { isManagedReady });
    installRestartBoundary(ctx, Context);
    const { marker, deactivate } = createDefaultModelPolicyMarker(createControllerProtectionGuard(ctx, Context, controllerModuleName));
    // The injected child owns these provisions and retains its native dependency.
    // Disposal/reload removes the private facade, never moving/replacing the
    // original service or changing its settings/configuration entry identity.
    bound.isolate(SERVICE, labels[SERVICE]).provide(SERVICE, policy);
    bound.isolate("llm", labels.llm).provide("llm", catalog);
    bound.provide(DEFAULT_MODEL_POLICY_SERVICE, marker);
    bound.effect(() => deactivate, "copilot-default-model-policy availability");
  });
}

export async function apply(ctx) {
  const loader = ctx.get?.("loader");
  if (typeof loader?.import !== "function") throw new Error("Copilot policy requires the DSH Host module loader");
  // Resolve the SAME Cordis instance as the Host, not a profile peer copy whose
  // Context symbols could belong to another runtime generation.
  const { Context } = await loader.import("@deepseek-ai/cordis");
  if (typeof Context?.is !== "function" || !Context.is(ctx)) throw new Error("Unsupported Copilot policy Context");
  installDefaultModelPolicy(ctx, Context);
}
