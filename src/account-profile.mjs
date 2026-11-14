// Reuse the installed exported config compiler in a brand-new private Cordis
// root. No app context is accepted or mutated, and no auth/settings service exists.
const NATIVE = "github-copilot";
const AUTH_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "api-key", "cookie"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const copy = (value) => structuredClone(value);

export class AccountProfileError extends Error {
  constructor(message, code) { super(message); this.name = "AccountProfileError"; this.code = code; }
}
function cloneAuth(value) {
  if (typeof value === "function" || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneAuth);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneAuth(entry)]));
}

/**
 * Compile one native Copilot raw profile using exported Config/apply, not a copy
 * of private resolveProfiles logic. Context must be the runtime's Context CLASS,
 * never an application context instance. Only a private LLM capture is provided.
 *
 * Returns detached compiled profile defaults and fresh native provider/auth
 * objects per factory call. The concrete adapter.current().profiles shape is
 * version-sensitive: shape mismatches fail closed instead of silently ignoring
 * configured model/protocol/compat policy. No authorization flow, model discovery,
 * credential read, launch environment, request stream or HTTP is invoked here.
 */
export async function compileAccountProfile({ Context, Config, applyPiAi, createNativeProvider: createBaseProvider,
  profile = {}, LlmError = AccountProfileError } = {}) {
  const errors = new WeakSet();
  const fail = (message, code) => { const error = new LlmError(message, code); errors.add(error); return error; };
  if (typeof Context !== "function" || typeof Config !== "function" || typeof applyPiAi !== "function" || typeof createBaseProvider !== "function") {
    throw fail("Native Copilot profile compiler is unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
  }
  if (!object(profile)) throw fail("Invalid native Copilot profile", "ACCOUNT_PROFILE_INVALID");
  let raw;
  try { raw = copy(profile); }
  catch { throw fail("Invalid native Copilot profile", "ACCOUNT_PROFILE_INVALID"); }
  if (raw.api !== undefined || raw.baseURL !== undefined) {
    throw fail("Account routes require native Copilot protocol and per-grant endpoint", "ACCOUNT_PROFILE_UNSUPPORTED");
  }
  for (const name of Object.keys(raw.headers ?? {})) {
    if (AUTH_HEADERS.has(name.toLowerCase())) throw fail("Account routes do not allow credential header overrides", "ACCOUNT_AUTH_OVERRIDE");
  }
  // Account OAuth exclusively owns auth. The raw reference is neither resolved
  // nor forwarded to a temporary context or the account adapter defaults.
  delete raw.apiKeyEnv;
  let root, owned = false, result;
  try {
    root = new Context();
    if (!root || typeof root.provide !== "function" || typeof root.get !== "function"
      || typeof root.fiber?.dispose !== "function") {
      throw fail("Isolated profile compiler context is unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
    }
    for (const service of ["llm", "settings", "authorization", "credentials", "launchEnvironment"]) {
      if (root.get(service) !== undefined) {
        // Never dispose or overwrite an accidentally supplied application root.
        throw fail("Profile compiler requires a fresh isolated context", "ACCOUNT_RUNTIME_UNAVAILABLE");
      }
    }
    owned = true;
    let captured;
    const capture = Object.freeze({
      registerConfigurableProviders() { return { replace() {} }; },
      registerModelDiscovery() { return () => {}; },
      registerAdapter(providers, adapter) {
        if (captured !== undefined || !Array.isArray(providers) || providers.length !== 1 || providers[0] !== NATIVE) {
          throw fail("Unexpected native profile compiler registration", "ACCOUNT_RUNTIME_UNAVAILABLE");
        }
        captured = adapter;
        return { replace() {} };
      },
    });
    root.provide("llm", capture);
    await applyPiAi(root, Config({ providers: { [NATIVE]: raw } }));
    if (typeof captured?.current !== "function") throw fail("Native profile compiler adapter is unavailable", "ACCOUNT_RUNTIME_UNAVAILABLE");
    const compiled = captured.current()?.profiles?.get?.(NATIVE);
    const provider = compiled?.piProvider;
    if (!compiled || compiled.provider !== NATIVE || !(compiled.modelErrors instanceof Map)
      || !(compiled.configuredMaxTokens instanceof Map)) {
      throw fail("Native Copilot compiled profile shape is unsupported", "ACCOUNT_RUNTIME_UNAVAILABLE");
    }
    if (compiled.catalogError !== undefined || compiled.modelErrors.size !== 0) {
      throw fail("Configured Copilot model policy could not be compiled", "ACCOUNT_PROFILE_INVALID");
    }
    if (provider?.id !== NATIVE || typeof provider.getModels !== "function"
      || typeof provider.stream !== "function" || typeof provider.streamSimple !== "function"
      || typeof provider.auth?.oauth?.refresh !== "function" || typeof provider.auth?.oauth?.toAuth !== "function") {
      throw fail("Native Copilot profile shape is unsupported", "ACCOUNT_RUNTIME_UNAVAILABLE");
    }
    const models = copy(provider.getModels());
    if (!Array.isArray(models) || models.length === 0 || models.some((model) => !object(model) || model.provider !== NATIVE || typeof model.id !== "string")) {
      throw fail("Compiled Copilot model policy is unavailable", "ACCOUNT_PROFILE_INVALID");
    }
    const { piProvider: _provider, ...defaults } = compiled;
    for (const key of ["apiKeyEnv", "provider", "displayName", "catalogError", "api", "baseURL"]) delete defaults[key];
    const profileDefaults = copy(defaults);
    const createNativeProvider = () => {
      const fresh = createBaseProvider();
      if (fresh?.id !== NATIVE || typeof fresh.stream !== "function" || typeof fresh.streamSimple !== "function") {
        throw fail("Native Copilot provider factory shape is unsupported", "ACCOUNT_RUNTIME_UNAVAILABLE");
      }
      const ownedModels = copy(models);
      // Native compilation materializes policy but reuseCatalogProvider drops
      // filterModels. Start from a NEW raw provider's stateless implementations,
      // retaining credential-dependent filtering and all safe optional operations.
      const result = { id: NATIVE, name: provider.name,
        ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
        ...(fresh.headers === undefined ? {} : { headers: copy(fresh.headers) }),
        auth: cloneAuth(provider.auth), getModels: () => ownedModels, getAllModels: () => ownedModels,
        stream: (model, context, options) => fresh.stream(model, context, options),
        streamSimple: (model, context, options) => fresh.streamSimple(model, context, options) };
      for (const method of ["filterModels", "filterAllModels", "fetchDeferred", "cancelDeferred", "generateImages", "classify"]) {
        if (typeof fresh[method] === "function") result[method] = (...args) => fresh[method](...args);
      }
      // Deliberately omit refreshModels: dynamic discovery must never replace the
      // settings-owned compiled model catalog (the native compiler does likewise).
      return result;
    };
    result = { profileDefaults, createNativeProvider };
  } catch (error) {
    if (errors.has(error)) throw error;
    // Native schema/header errors may contain supplied values; no cause or raw
    // compiler diagnostic crosses the plugin's account-policy boundary.
    throw fail("Configured Copilot profile could not be compiled", "ACCOUNT_PROFILE_INVALID");
  } finally {
    if (owned) {
      try { await root.fiber.dispose(); }
      catch { throw fail("Isolated profile compiler cleanup failed", "ACCOUNT_RUNTIME_UNAVAILABLE"); }
    }
  }
  return result;
}
