import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { compileAccountProfile } from "../src/account-profile.mjs";
import { createAccountAdapter } from "../src/account-adapter.mjs";

const NATIVE = "github-copilot";
const clone = (value) => structuredClone(value);
function fixture(behavior = {}) {
  const roots = [], configs = [], calls = [];
  class Context {
    constructor() {
      this.services = new Map(behavior.preexisting ? [["llm", behavior.preexisting]] : []);
      this.provided = []; this.disposed = false;
      this.fiber = { dispose: async () => { this.disposed = true; this.services.clear(); if (behavior.disposeThrows) throw new Error("FAKE_PRIVATE_CLEANUP"); } };
      roots.push(this);
    }
    get(name) { return this.services.get(name); }
    provide(name, value) { assert.equal(this.services.has(name), false); this.services.set(name, value); this.provided.push(name); }
  }
  const Config = (raw) => { configs.push(clone(raw)); if (behavior.configThrows) throw new Error("FAKE_PRIVATE_CONFIG_VALUE"); return raw; };
  const createNativeProvider = () => ({ id: NATIVE, name: "Configured Copilot", baseUrl: "https://example.invalid",
    auth: { apiKey: { name: "native", extra: { values: ["immutable-code-data"] }, resolve: () => "mock" }, oauth: { name: "OAuth", refresh: () => "mock", toAuth: () => "mock" } },
    getModels: () => behavior.emptyModels ? [] : [{ id: "fake-model", provider: NATIVE, api: "openai-responses", contextWindow: 12345, input: ["text"] }],
    filterModels: (models, credential) => credential?.type === "oauth" && Array.isArray(credential.availableModelIds)
      ? models.filter((model) => credential.availableModelIds.includes(model.id)) : models,
    refreshModels: () => { throw new Error("dynamic discovery must stay disabled"); },
    stream: (...args) => { calls.push(args); return "MOCK_STREAM"; },
    streamSimple: (...args) => { calls.push(args); return "MOCK_SIMPLE"; },
    fetchDeferred: () => "MOCK_DEFERRED",
  });
  const applyPiAi = (root, config) => {
    for (const name of ["settings", "authorization", "credentials", "launchEnvironment"]) assert.equal(root.get(name), undefined);
    if (behavior.applyThrows) throw new Error("FAKE_PRIVATE_APPLY_VALUE");
    const provider = createNativeProvider();
    delete provider.filterModels; // Model the real reuseCatalogProvider omission.
    delete provider.refreshModels;
    const profile = { provider: NATIVE, displayName: "Compiled Label", streamIdleTimeoutMs: 1111,
      configuredMaxTokens: new Map([["fake-model", 123]]), modelErrors: behavior.modelError ? new Map([["bad", "FAKE_PRIVATE_MODEL_ERROR"]]) : new Map(),
      ...(behavior.catalogError ? { catalogError: "FAKE_PRIVATE_CATALOG_ERROR" } : {}),
      headers: clone(config.providers[NATIVE].headers ?? {}), piProvider: provider };
    const capture = root.get("llm");
    capture.registerConfigurableProviders([]); capture.registerModelDiscovery("private", () => { throw new Error("must never be called"); });
    if (!behavior.noRegistration) capture.registerAdapter(behavior.wrongRoute ? ["other"] : [NATIVE], { current: () => ({ profiles: new Map([[NATIVE, profile]]) }) });
  };
  const run = (profile = {}) => compileAccountProfile({ Context, Config, applyPiAi, createNativeProvider, profile });
  return { roots, configs, calls, Context, Config, applyPiAi, createNativeProvider, run };
}

test("private profile compilation provides only capture LLM, disposes root, detaches policy", async () => {
  const f = fixture();
  const raw = { apiKeyEnv: "FAKE_REF_NEVER_RESOLVED", headers: { "X-Profile": "safe" }, models: [{ id: "fake-model" }] };
  const before = clone(raw), compiled = await f.run(raw);
  assert.deepEqual(raw, before);
  assert.equal(f.roots.length, 1); assert.deepEqual(f.roots[0].provided, ["llm"]);
  assert.equal(f.roots[0].disposed, true); assert.equal(f.roots[0].services.size, 0);
  assert.equal(f.configs[0].providers[NATIVE].apiKeyEnv, undefined);
  assert.equal(compiled.profileDefaults.apiKeyEnv, undefined);
  assert.equal(compiled.profileDefaults.provider, undefined);
  assert.equal(compiled.profileDefaults.piProvider, undefined);
  assert.equal(compiled.profileDefaults.streamIdleTimeoutMs, 1111);
  assert.equal(compiled.profileDefaults.configuredMaxTokens.get("fake-model"), 123);
  assert.deepEqual(compiled.profileDefaults.headers, { "X-Profile": "safe" });
});

test("native factory returns independent provider/auth/model objects that survive disposal", async () => {
  const f = fixture(), compiled = await f.run(), a = compiled.createNativeProvider(), b = compiled.createNativeProvider();
  assert.notEqual(a, b); assert.notEqual(a.auth, b.auth); assert.notEqual(a.auth.oauth, b.auth.oauth); assert.notEqual(a.auth.apiKey, b.auth.apiKey);
  a.auth.apiKey.extra.values.push("changed");
  assert.deepEqual(b.auth.apiKey.extra.values, ["immutable-code-data"]);
  a.getModels()[0].contextWindow = 1;
  assert.equal(b.getModels()[0].contextWindow, 12345);
  assert.equal(a.id, NATIVE); assert.equal(b.getModels()[0].provider, NATIVE);
  assert.equal(a.stream({ provider: NATIVE }, {}, {}), "MOCK_STREAM");
  assert.equal(b.streamSimple({ provider: NATIVE }, {}, {}), "MOCK_SIMPLE");
  assert.equal(f.calls.length, 2);
  assert.equal(a.fetchDeferred(), "MOCK_DEFERRED");
  assert.equal(a.refreshModels, undefined, "dynamic discovery cannot replace the compiled policy catalog");
  assert.deepEqual(a.filterModels(a.getModels(), { type: "oauth", availableModelIds: [] }), []);
  assert.deepEqual(b.filterModels(b.getModels(), { type: "oauth", availableModelIds: ["fake-model"] }).map((model) => model.id), ["fake-model"]);
  assert.equal(f.roots[0].disposed, true);
});

test("native endpoint/protocol overrides and credential headers are rejected before creating a context", async () => {
  const f = fixture();
  for (const profile of [{ api: "openai-responses" }, { baseURL: "https://wrong.invalid" }]) await assert.rejects(f.run(profile), { code: "ACCOUNT_PROFILE_UNSUPPORTED" });
  for (const header of ["Authorization", "X-API-KEY", "Proxy-Authorization", "Cookie", "api-key"]) {
    await assert.rejects(f.run({ headers: { [header]: "FAKE_SECRET" } }), { code: "ACCOUNT_AUTH_OVERRIDE" });
  }
  assert.equal(f.roots.length, 0);
  await assert.rejects(f.run([]), { code: "ACCOUNT_PROFILE_INVALID" });
  await assert.rejects(f.run({ badFunction() {} }), { code: "ACCOUNT_PROFILE_INVALID" });
});

test("compiler diagnostics and deferred model errors are contained and temporary contexts cleaned", async () => {
  for (const behavior of [{ configThrows: true }, { applyThrows: true }, { modelError: true }, { catalogError: true }, { emptyModels: true }]) {
    const f = fixture(behavior);
    await assert.rejects(f.run(), (error) => error.code === "ACCOUNT_PROFILE_INVALID" && !error.message.includes("PRIVATE") && error.cause === undefined);
    assert.equal(f.roots[0].disposed, true);
  }
  for (const behavior of [{ noRegistration: true }, { wrongRoute: true }, { disposeThrows: true }]) {
    const f = fixture(behavior);
    await assert.rejects(f.run(), (error) => error.code === "ACCOUNT_RUNTIME_UNAVAILABLE" && !error.message.includes("PRIVATE"));
    assert.equal(f.roots[0].disposed, true);
  }
});

test("compiler never overwrites or disposes a preexisting application service context", async () => {
  const service = { untouched: true }, f = fixture({ preexisting: service });
  await assert.rejects(f.run(), { code: "ACCOUNT_RUNTIME_UNAVAILABLE" });
  assert.equal(f.roots[0].get("llm"), service);
  assert.deepEqual(f.roots[0].provided, []); assert.equal(f.roots[0].disposed, false);
  await assert.rejects(compileAccountProfile(), { code: "ACCOUNT_RUNTIME_UNAVAILABLE" });
});

const root = new URL("../../dsh-session-account-review/installed/dsh/node_modules/", import.meta.url);
const runtimeUrl = new URL("@deepseek-ai/dsh-llm-pi-ai/lib/index.js", root);
test("installed Config/apply/private Context preserve real configured models, overrides and limits offline", { skip: existsSync(runtimeUrl) ? false : "optional extracted DSH installation fixture absent" }, async (t) => {
  const previousFetch = globalThis.fetch; let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw new Error("offline compiler may not request network"); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const [{ Context }, { Config, apply: applyPiAi }, { githubCopilotProvider }] = await Promise.all([
    import(new URL("@deepseek-ai/cordis/lib/index.js", root).href), import(runtimeUrl.href),
    import(new URL("@earendil-works/pi-ai/dist/providers/github-copilot.js", root).href),
  ]);
  const roots = [];
  class ObservedContext extends Context { constructor() { super(); roots.push(this); } }
  const catalog = githubCopilotProvider().getModels();
  const chosen = catalog.find((model) => model.api === "openai-completions");
  assert.ok(chosen);
  const raw = { apiKeyEnv: "FAKE_REF_NEVER_RESOLVED", models: [{ id: chosen.id, name: "Configured Copy", contextWindow: 55555, maxTokens: 1234, input: ["text"], reasoningEfforts: { off: null, high: "high" }, compat: { supportsDeveloperRole: false } }],
    headers: { "X-Profile": "safe" }, reasoning: "high", thinkingBudgets: { high: 2048 }, cacheRetention: "short", transport: "sse", timeoutMs: 12345,
    streamIdleTimeoutMs: 9000, maxRequestImageBytes: 8192, maxRequestImages: 3, imageOffloadCountQuantum: 1, requestImagePixelBudget: 1024, requestImageMaxBytes: 4096,
    retryPolicy: { mode: "normal", maxRetries: 2, retryableCodes: ["TIMEOUT"], backoff: { initialDelayMs: 100, maxDelayMs: 200, jitterRatio: 0 } } };
  const before = clone(raw);
  const compiled = await compileAccountProfile({ Context: ObservedContext, Config, applyPiAi, createNativeProvider: githubCopilotProvider, profile: raw });
  const provider = compiled.createNativeProvider(), models = provider.getModels(), defaults = compiled.profileDefaults;
  assert.equal(models.length, 1); assert.equal(models[0].provider, NATIVE); assert.equal(models[0].api, chosen.api);
  assert.equal(models[0].id, chosen.id); assert.equal(models[0].name, "Configured Copy");
  assert.equal(models[0].contextWindow, 55555); assert.equal(models[0].maxTokens, 1234); assert.deepEqual(models[0].input, ["text"]);
  assert.equal(models[0].thinkingLevelMap.high, "high"); assert.equal(models[0].thinkingLevelMap.medium, null);
  assert.equal(models[0].compat.supportsDeveloperRole, false);
  assert.equal(defaults.configuredMaxTokens.get(chosen.id), 1234); assert.equal(defaults.modelErrors.size, 0);
  for (const key of ["reasoning", "thinkingBudgets", "cacheRetention", "transport", "timeoutMs", "streamIdleTimeoutMs", "maxRequestImageBytes", "maxRequestImages", "imageOffloadCountQuantum", "requestImagePixelBudget", "requestImageMaxBytes", "headers"]) assert.deepEqual(defaults[key], raw[key], key);
  assert.equal(defaults.apiKeyEnv, undefined);
  assert.deepEqual(defaults.retryPolicy, { mode: "normal", maxRetries: 2, retryableCodes: ["TIMEOUT"], initialDelayMs: 100, maxDelayMs: 200, jitterRatio: 0 });
  const [{ PiAiAdapter }, { LlmAdapter, LlmError }] = await Promise.all([import(runtimeUrl.href), import(new URL("@deepseek-ai/dsh-llm/lib/index.js", root).href)]);
  const fakeGrant = { kind: "grant", payload: { type: "oauth", refresh: "FAKE_PROFILE_REFRESH", access: "FAKE_PROFILE_ACCESS", expires: Date.now() + 3600000, availableModelIds: [chosen.id] } };
  const accountAdapter = createAccountAdapter({ LlmAdapter, PiAiAdapter, LlmError, ...compiled,
    accountId: "copilot-auth/account-profile-test", routeId: "copilot-account-profile-test",
    credentials: { async readRecord() { return clone(fakeGrant); }, async modifyRecord() { throw new Error("metadata-only test must not refresh"); } } });
  const info = await accountAdapter.resolveModel("copilot-account-profile-test", chosen.id);
  assert.equal(info.provider, "copilot-account-profile-test"); assert.equal(info.context.contextWindow, 55555); assert.equal(info.defaultMaxTokens, 1234);
  assert.deepEqual(accountAdapter.providerRetryPolicy("copilot-account-profile-test"), defaults.retryPolicy);
  assert.deepEqual((await accountAdapter.listModels("copilot-account-profile-test")).map((model) => model.id), [chosen.id]);
  accountAdapter.dispose();
  assert.deepEqual(raw, before, "target config is never mutated");
  assert.equal(roots.length, 1);
  for (const name of ["llm", "settings", "authorization", "credentials", "launchEnvironment"]) assert.equal(roots[0].get(name), undefined, name);
  const second = compiled.createNativeProvider(); assert.notEqual(provider.auth.oauth, second.auth.oauth);
  provider.getModels()[0].contextWindow = 1; assert.equal(second.getModels()[0].contextWindow, 55555);
  const override = await compileAccountProfile({ Context: ObservedContext, Config, applyPiAi, createNativeProvider: githubCopilotProvider, profile: { modelOverrides: { [chosen.id]: { name: "Override Copy", contextWindow: 22222, maxTokens: 333, input: ["text"], reasoningEfforts: false, compat: { supportsDeveloperRole: false } } } } });
  const target = override.createNativeProvider().getModels().find((model) => model.id === chosen.id);
  assert.equal(override.createNativeProvider().getModels().length, catalog.length);
  assert.equal(target.name, "Override Copy"); assert.equal(target.contextWindow, 22222); assert.equal(target.maxTokens, 333); assert.equal(target.reasoning, false);
  assert.equal(override.profileDefaults.configuredMaxTokens.get(chosen.id), 333);
  const filteredProvider = override.createNativeProvider(), rawProvider = githubCopilotProvider();
  for (const availableModelIds of [[], [chosen.id], catalog.slice(0, 3).map((model) => model.id)]) {
    const credential = { type: "oauth", availableModelIds };
    assert.deepEqual(filteredProvider.filterModels(filteredProvider.getModels(), credential).map((model) => model.id),
      rawProvider.filterModels(filteredProvider.getModels(), credential).map((model) => model.id), "compiled models retain native credential filtering");
  }
  assert.equal(filteredProvider.refreshModels, undefined);
  await assert.rejects(compileAccountProfile({ Context: ObservedContext, Config, applyPiAi, createNativeProvider: githubCopilotProvider, profile: { models: [{ id: "not-in-installed-copilot-catalog" }] } }), { code: "ACCOUNT_PROFILE_INVALID" });
  assert.equal(networkAttempts, 0);
});
