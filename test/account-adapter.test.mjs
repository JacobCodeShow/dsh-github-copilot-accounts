import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountAdapter, createAccountCredentialStore, accountMessagesToNative, NATIVE_COPILOT_PROVIDER as NATIVE } from "../src/account-adapter.mjs";
import { requestContextKey, requestTransportKey } from "../src/session-request-state.mjs";
import { ACCOUNT_REQUEST_CONTEXT } from "../src/account-request-context.mjs";
import { GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";

const A = "copilot-auth/account-a", B = "copilot-auth/account-b";
const RA = "copilot-account-a", RB = "copilot-account-b";
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const grant = (account, availableModelIds = ["text", "tools"]) => ({ kind: "grant", payload: { type: "oauth", refresh: `FAKE_${account}_REFRESH`, access: `FAKE_${account}_ACCESS`, expires: Date.now() + 3600000, enterpriseUrl: `company-${account.toLowerCase()}.ghe.com`, availableModelIds, account: { login: "alice", domain: `company-${account.toLowerCase()}.ghe.com`, avatarUrl: "https://example.invalid/avatar", pluginData: { retained: true } } } });
function memory(initial = { [A]: grant("A"), [B]: grant("B") }) {
  const records = new Map(Object.entries(initial).map(([key, value]) => [key, copy(value)]));
  const tails = new Map(), reads = [], writes = [], deletes = [];
  return { records, reads, writes, deletes,
    async readRecord(key) { reads.push(key); return copy(records.get(key)); },
    modifyRecord(key, mutate) {
      const op = (tails.get(key) ?? Promise.resolve()).then(async () => {
        const next = await mutate(copy(records.get(key)));
        if (next !== undefined) { records.set(key, copy(next)); writes.push(key); }
        return copy(records.get(key));
      });
      tails.set(key, op.catch(() => {})); return op;
    },
    async deleteRecord(key) { await (tails.get(key) ?? Promise.resolve()); records.delete(key); deletes.push(key); },
  };
}
const catalog = [
  { id: "text", name: "Text Model", provider: NATIVE, api: "openai-responses", baseUrl: "https://example.invalid", contextWindow: 123000, maxTokens: 4096, input: ["text", "image"], reasoning: true },
  { id: "tools", name: "Tool Model", provider: NATIVE, api: "anthropic-messages", baseUrl: "https://example.invalid", contextWindow: 456000, maxTokens: 8192, input: ["text"], reasoning: false },
];
function fixture(extra = {}) {
  const credentials = extra.credentials ?? memory();
  const captures = [], nativeInstances = [], refreshes = [], closeCalls = [], protocolCalls = [];
  const behavior = { stall: undefined, ...extra.behavior };
  class Base {}
  class FakePiAiAdapter extends Base {
    constructor(config) { super(); this.config = config; nativeInstances.push(this); }
    profile(snapshot = this.config.profiles()) { return snapshot.get(NATIVE); }
    model(id, snapshot = this.config.profiles()) {
      const model = this.profile(snapshot).piProvider.getModels().find((m) => m.id === id);
      if (!model) throw Object.assign(new Error("model absent in pinned native generation"), { code: "UNKNOWN_MODEL" });
      return model;
    }
    providerRetryPolicy(provider) { assert.equal(provider, NATIVE); return this.profile().retryPolicy; }
    imageRequestPricing(provider, model) { assert.equal(provider, NATIVE); return { pricing: model, native: provider }; }
    imageRequestTarget(provider, model, image) { assert.equal(provider, NATIVE); this.model(model); return { width: image.width / 2, height: image.height / 2, maxBytes: this.profile().requestImageMaxBytes }; }
    async listModels(provider) { assert.equal(provider, NATIVE); return this.profile().piProvider.getModels().map((m) => ({ provider, id: m.id, name: m.name, inputModalities: [...m.input] })); }
    async resolveModel(provider, model) {
      assert.equal(provider, NATIVE);
      const m = this.model(model);
      return { provider, id: model, name: m.name, inputModalities: [...m.input], context: { contextWindow: m.contextWindow }, reasoningEfforts: ["off", "high"], conversationUpdates: { tools: "in-history" }, customCapability: { retained: true } };
    }
    async prepareCall(provider, model, signal) {
      assert.equal(provider, NATIVE); signal?.throwIfAborted();
      const snapshot = this.config.profiles();
      const description = await this.resolveModel(provider, model);
      return { model: description, stream: (options) => this.generate(snapshot, options) };
    }
    async *generate(snapshot, options) {
      assert.equal(options.provider, NATIVE);
      const model = this.model(options.model, snapshot);
      let credential = await this.config.auth.credentials.read(NATIVE, { signal: options.signal });
      if (credential.expires <= Date.now()) {
        credential = await this.config.auth.credentials.modify(NATIVE, async (current) => {
          if (current.expires > Date.now()) return undefined;
          refreshes.push(current.refresh);
          return { ...current, access: current.access + "_ROTATED", expires: Date.now() + 3600000, account: { forbiddenOverwrite: true }, optionalNativeField: undefined,
            ...(behavior.revokeOnRefresh ? { availableModelIds: [] } : {}) };
        }, { signal: options.signal });
      }
      assert.equal(await this.config.resolveApiKey(NATIVE, this.profile(snapshot)), undefined);
      assert.equal(await this.config.auth.authContext.env("FAKE_ENV"), undefined);
      assert.equal(await this.config.auth.authContext.fileExists("/not-accessed"), false);
      const headers = this.config.prepareHeaders({ provider: NATIVE, model: options.model }, new Headers());
      const nativeOptions = { ...options, apiKey: credential.access, headers, baseUrl: `https://copilot-api.${credential.enterpriseUrl}` };
      const capture = { options: nativeOptions, model: copy(model), snapshot, nativeReplay: [] };
      captures.push(capture);
      behavior.captureReady?.resolve();
      if (behavior.stall) { await behavior.stall.promise; options.signal?.throwIfAborted(); }
      await behavior.afterAuth?.({ credential, options });
      yield* this.profile(snapshot).piProvider.streamSimple(model, { messages: options.messages }, nativeOptions);
    }
  }
  function createNativeProvider() {
    return { id: NATIVE, name: "GitHub Copilot", auth: { oauth: { name: "fake-native" } }, getModels: () => copy(catalog),
      streamSimple(model, context, options) {
        protocolCalls.push({ model: copy(model), apiKey: options.apiKey });
        assert.equal(model.provider, NATIVE);
        return (async function* () {
          try {
            yield { type: "block-start", index: 0, blockType: "reasoning" };
            yield { type: "reasoning-delta", index: 0, text: "mock reasoning" };
            yield { type: "block-end", index: 0, block: { type: "reasoning", text: "mock reasoning" } };
            yield { type: "block-start", index: 1, blockType: "tool-call" };
            yield { type: "tool-call-delta", index: 1, id: "fake-tool", name: "lookup", argumentsDelta: '{"query":"safe"}' };
            yield { type: "block-end", index: 1, block: { type: "tool-call", id: "fake-tool", name: "lookup", arguments: '{"query":"safe"}' } };
            yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
            yield { type: "finish", reason: { kind: "tool-calls" }, replayState: { response: { kind: "pi-ai", version: 2, provider: model.provider, model: model.id, api: model.api, responseId: "FAKE_RESPONSE_ID", stopReason: "toolUse" }, blocks: [{ type: "reasoning", thinkingSignature: "FAKE_SIGNATURE_" + options.apiKey }, { type: "tool-call", thoughtSignature: "FAKE_TOOL_SIGNATURE", namespace: "FAKE_NAMESPACE" }] } };
          } finally { closeCalls.push(model.id); }
        })();
      },
    };
  }
  const make = (accountId = A, routeId = RA, options = {}) => createAccountAdapter({ LlmAdapter: Base, PiAiAdapter: FakePiAiAdapter, createNativeProvider, credentials, accountId, routeId, displayName: `Label ${accountId}`, ...extra.options, ...options });
  return { credentials, captures, nativeInstances, refreshes, closeCalls, protocolCalls, behavior, make, Base, FakePiAiAdapter, createNativeProvider };
}
const request = (provider = RA, model = "tools", extra = {}) => ({ provider, model, messages: [{ role: "user", content: [{ type: "text", text: "offline test" }] }], tools: [{ name: "lookup", parameters: { type: "object" } }], ...extra });
const collect = async (iterable) => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks; };
const finish = (chunks) => chunks.find((chunk) => chunk.type === "finish");
const assistant = (provider, model, replayState) => ({ role: "assistant", content: [{ type: "reasoning", text: "mock reasoning" }, { type: "tool-call", id: "fake-tool", name: "lookup", arguments: '{"query":"safe"}' }], source: { provider, model, replayState } });

test("account aliases preserve capabilities, retry and image forwarding with native ids", async () => {
  const f = fixture(), retryPolicy = { attempts: 2 };
  let label = "company-a.ghe.com/alice";
  const a = f.make(A, RA, { displayName: () => label, profileDefaults: { retryPolicy, requestImageMaxBytes: 1234 } });
  assert.ok(a instanceof f.Base);
  assert.deepEqual(a.providerInfo(RA), { id: RA, name: label });
  label = "Renamed Account"; assert.equal(a.providerInfo(RA).name, label);
  assert.deepEqual(a.providerRetryPolicy(RA), retryPolicy);
  assert.deepEqual(a.imageRequestPricing(RA, "text"), { pricing: "text", native: NATIVE });
  assert.deepEqual(a.imageRequestTarget(RA, "text", { width: 200, height: 100, bytes: 9999 }), { width: 100, height: 50, maxBytes: 1234 });
  assert.equal(f.credentials.reads.length, 0, "synchronous helper methods do no credential I/O");
  const models = await a.listModels(RA);
  assert.deepEqual(models.map((m) => m.provider), [RA, RA]);
  const resolved = await a.resolveModel(RA, "text");
  assert.equal(resolved.provider, RA); assert.equal(resolved.context.contextWindow, 123000);
  assert.deepEqual(resolved.reasoningEfforts, ["off", "high"]);
  assert.deepEqual(resolved.conversationUpdates, { tools: "in-history" });
  assert.deepEqual(resolved.customCapability, { retained: true });
  resolved.context.contextWindow = 1;
  assert.equal((await a.resolveModel(RA, "text")).context.contextWindow, 123000);
});

test("two concurrent account streams never read/write a shared main credential", async () => {
  const f = fixture(), a = f.make(), b = f.make(B, RB);
  const [ca, cb] = await Promise.all([collect(a.stream(request())), collect(b.stream(request(RB)))]);
  assert.equal(f.nativeInstances.length, 2);
  assert.deepEqual(f.captures.map((c) => c.model.provider), [NATIVE, NATIVE]);
  const sent = f.captures.map((c) => [c.options.apiKey, c.options.baseUrl]).sort();
  assert.deepEqual(sent, [["FAKE_A_ACCESS", "https://copilot-api.company-a.ghe.com"], ["FAKE_B_ACCESS", "https://copilot-api.company-b.ghe.com"]]);
  assert.ok(f.credentials.reads.every((key) => key === A || key === B));
  assert.ok(!f.credentials.reads.includes("llm-pi-ai/github-copilot"));
  assert.equal(finish(ca).replayState.accountId, A); assert.equal(finish(cb).replayState.accountId, B);
  assert.equal(a.accountId, A); assert.equal(a.routeId, RA);
  assert.throws(() => { a.accountId = B; }, TypeError);
});

test("same-account multi-turn reasoning/tool replay unwraps native signatures losslessly", async () => {
  const f = fixture(), a = f.make();
  const first = await collect(a.stream(request()));
  const terminal = finish(first);
  assert.equal(terminal.replayState.kind, "copilot-account");
  assert.equal(terminal.replayState.version, 1);
  assert.equal(terminal.replayState.native.response.provider, NATIVE);
  assert.equal(terminal.reason.kind, "tool-calls");
  assert.ok(first.some((c) => c.type === "tool-call-delta"));
  const history = [request().messages[0], assistant(RA, "tools", terminal.replayState), { role: "tool", content: [{ type: "tool-result", id: "fake-tool", content: "safe result" }] }];
  const before = copy(history);
  await collect(a.stream(request(RA, "tools", { messages: history })));
  const nativeHistory = f.captures.at(-1).options.messages;
  assert.equal(nativeHistory[1].source.provider, NATIVE);
  assert.deepEqual(nativeHistory[1].source.replayState, terminal.replayState.native);
  assert.equal(nativeHistory[1].source.replayState.blocks[0].thinkingSignature, "FAKE_SIGNATURE_FAKE_A_ACCESS");
  assert.deepEqual(nativeHistory[2], history[2]);
  assert.deepEqual(history, before, "durable caller history must not be mutated");
});

test("foreign-account replay never becomes native even when model ids are identical", async () => {
  const f = fixture(), a = f.make(), b = f.make(B, RB);
  const envelopeA = finish(await collect(a.stream(request()))).replayState;
  const foreign = assistant(RA, "tools", envelopeA);
  await collect(b.stream(request(RB, "tools", { messages: [foreign] })));
  const passed = f.captures.at(-1).options.messages[0];
  assert.equal(passed.source.provider, RA);
  assert.equal(passed.source.replayState, undefined);
  assert.ok(!JSON.stringify(passed).includes("FAKE_SIGNATURE"));
  assert.deepEqual(passed.content, foreign.content, "durable reasoning text/tool arguments remain provider-neutral");
});

test("replay requires matching public route, immutable account, wrapper version and model", () => {
  const raw = { response: { kind: "pi-ai", version: 2, provider: NATIVE, model: "tools" }, blocks: [] };
  const valid = { kind: "copilot-account", version: 1, accountId: A, native: raw };
  for (const [provider, envelope] of [[RA, { ...valid, accountId: B }], [RB, valid], [RA, { ...valid, version: 2 }], [RA, { ...valid, kind: "other" }], [RA, raw], [RA, { ...valid, native: { ...raw, response: { ...raw.response, provider: "other" } } }], [RA, { ...valid, native: { ...raw, response: { ...raw.response, model: "text" } } }]]) {
    const [message] = accountMessagesToNative([assistant(provider, "tools", envelope)], { routeId: RA, accountId: A });
    assert.equal(message.source.replayState, undefined);
    assert.equal(message.source.provider, provider);
  }
  const [message] = accountMessagesToNative([assistant(RA, "tools", valid)], { routeId: RA, accountId: A });
  assert.equal(message.source.provider, NATIVE); assert.deepEqual(message.source.replayState, raw);
  const [missing] = accountMessagesToNative([{ role: "assistant", content: [] }], { routeId: RA, accountId: A });
  assert.equal(missing.source.provider, "copilot-foreign");
});

test("prepared call pins native profile generation while other catalog queries advance", async () => {
  const f = fixture(), a = f.make();
  const call = await a.prepareCall(RA, "tools");
  const firstSnapshot = f.nativeInstances[0].config.profiles();
  f.credentials.records.get(A).payload.availableModelIds = ["tools"];
  assert.deepEqual((await a.listModels(RA)).map((m) => m.id), ["tools"]);
  assert.notEqual(f.nativeInstances[0].config.profiles(), firstSnapshot);
  await collect(call.stream(request()));
  assert.equal(f.captures[0].snapshot, firstSnapshot);
  assert.equal(call.model.provider, RA);
  await assert.rejects(collect(call.stream(request(RB))), { code: "NO_ADAPTER" });
  await assert.rejects(collect(call.stream(request(RA, "text"))), { code: "PREPARED_CALL_MISMATCH" });
});

test("missing/deleted/disabled accounts and revoked models fail closed", async () => {
  const f = fixture(), a = f.make();
  f.credentials.records.get(A).payload.availableModelIds = ["text"];
  assert.deepEqual((await a.listModels(RA)).map((m) => m.id), ["text"]);
  await assert.rejects(a.resolveModel(RA, "tools"), { code: "UNKNOWN_MODEL" });
  const prepared = await a.prepareCall(RA, "text");
  f.credentials.records.get(A).payload.availableModelIds = [];
  assert.deepEqual(await a.listModels(RA), []);
  await assert.rejects(collect(prepared.stream(request(RA, "text"))), { code: "UNKNOWN_MODEL" });
  f.credentials.records.get(A).payload.account.disabled = true;
  await assert.rejects(a.listModels(RA), { code: "ACCOUNT_UNAVAILABLE" });
  f.credentials.records.delete(A);
  await assert.rejects(collect(prepared.stream(request(RA, "text"))), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal(f.captures.length, 0);
  assert.equal(f.credentials.records.get(B).payload.access, "FAKE_B_ACCESS");
});

test("available models intersect the native catalog and explicit configured subset", async () => {
  const f = fixture(), a = f.make(A, RA, { modelIds: ["tools", "unknown"] });
  f.credentials.records.get(A).payload.availableModelIds = ["text", "tools", "unknown"];
  assert.deepEqual((await a.listModels(RA)).map((m) => m.id), ["tools"]);
  delete f.credentials.records.get(A).payload.availableModelIds;
  assert.deepEqual((await a.listModels(RA)).map((m) => m.id), ["tools"]);
  f.credentials.records.get(A).payload.availableModelIds = [42];
  await assert.rejects(a.listModels(RA), { code: "INVALID_ACCOUNT_GRANT" });
});

test("fake native OAuth refresh is serialized to A only and preserves plugin metadata", async () => {
  const f = fixture(), a = f.make(), b = f.make(B, RB);
  f.credentials.records.get(A).payload.expires = 0;
  const metadata = copy(f.credentials.records.get(A).payload.account);
  await Promise.all([collect(a.stream(request())), collect(a.stream(request())), collect(b.stream(request(RB)))]);
  assert.deepEqual(f.refreshes, ["FAKE_A_REFRESH"]);
  assert.deepEqual(f.credentials.writes, [A]);
  assert.deepEqual(f.credentials.records.get(A).payload.account, metadata);
  assert.equal(f.credentials.records.get(A).payload.optionalNativeField, undefined);
  assert.equal(Object.hasOwn(f.credentials.records.get(A).payload, "optionalNativeField"), false);
  assert.equal(f.credentials.records.get(A).payload.access, "FAKE_A_ACCESS_ROTATED");
  assert.equal(f.credentials.records.get(B).payload.access, "FAKE_B_ACCESS");
});

test("model revoked by auth refresh fails before mock protocol, without account fallback", async () => {
  const f = fixture({ behavior: { revokeOnRefresh: true } }), a = f.make();
  f.credentials.records.get(A).payload.expires = 0;
  await assert.rejects(collect(a.stream(request())), (error) => error.code === "UNKNOWN_MODEL" && !error.message.includes("protocol-guard"));
  assert.deepEqual(f.refreshes, ["FAKE_A_REFRESH"]);
  assert.deepEqual(f.credentials.records.get(A).payload.availableModelIds, []);
  assert.equal(f.protocolCalls.length, 0);
  assert.equal(f.credentials.records.get(B).payload.access, "FAKE_B_ACCESS");
});

test("post-auth deletion, disabling and disposal stop protocol entry", async (t) => {
  for (const change of ["deleted", "disabled", "disposed"]) await t.test(change, async () => {
    const f = fixture(), a = f.make();
    f.behavior.afterAuth = () => {
      if (change === "deleted") f.credentials.records.delete(A);
      if (change === "disabled") f.credentials.records.get(A).payload.account.disabled = true;
      if (change === "disposed") a.dispose();
    };
    await assert.rejects(collect(a.stream(request())), (error) => error.code === "ACCOUNT_UNAVAILABLE" && !error.message.includes("protocol-guard"));
    assert.equal(f.protocolCalls.length, 0);
  });
});

test("credential-store modify rechecks under lock; cancelled wait and logout never recreate slots", async () => {
  const service = memory(), store = createAccountCredentialStore({ credentials: service, accountId: A });
  const blocker = deferred(), entered = deferred();
  const first = service.modifyRecord(A, async () => { entered.resolve(); await blocker.promise; return undefined; });
  await entered.promise;
  const aborter = new AbortController(); let ran = false;
  const waiting = store.modify(NATIVE, () => { ran = true; return grant("A").payload; }, { signal: aborter.signal });
  aborter.abort(new Error("cancelled wait"));
  await assert.rejects(waiting, /cancelled wait/);
  blocker.resolve(); await first;
  await service.modifyRecord(A, () => undefined);
  assert.equal(ran, false);
  service.records.delete(A);
  await assert.rejects(store.modify(NATIVE, () => grant("A").payload), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal(service.records.has(A), false);
});

test("account store only addresses its own slot and refuses API-key mutation", async () => {
  const service = memory(), store = createAccountCredentialStore({ credentials: service, accountId: A });
  const first = await store.read(NATIVE); first.account.login = "mutated caller copy";
  assert.equal(service.records.get(A).payload.account.login, "alice");
  assert.deepEqual(await store.list(), [{ providerId: NATIVE, type: "oauth" }]);
  await assert.rejects(store.read("github-copilot-account-b"), { code: "NO_ADAPTER" });
  await assert.rejects(store.modify("other", () => undefined), { code: "NO_ADAPTER" });
  await assert.rejects(store.delete("other"), { code: "NO_ADAPTER" });
  await assert.rejects(store.modify(NATIVE, () => ({ type: "api_key", key: "FAKE" })), { code: "INVALID_ACCOUNT_GRANT" });
  await store.delete(NATIVE);
  assert.deepEqual(service.deletes, [A]); assert.equal(service.records.has(B), true);
  assert.throws(() => createAccountCredentialStore({ credentials: service, accountId: "llm-pi-ai/github-copilot" }), { code: "INVALID_ACCOUNT_ID" });
});

test("preparation cancellation settles before a delayed credential read completes", async () => {
  const f = fixture(), wait = deferred(), started = deferred();
  const originalRead = f.credentials.readRecord;
  f.credentials.readRecord = async (key) => { started.resolve(); await wait.promise; return originalRead(key); };
  const a = f.make(), aborter = new AbortController();
  const pending = a.prepareCall(RA, "tools", aborter.signal);
  await started.promise; aborter.abort(new Error("cancelled preparation"));
  await assert.rejects(pending, /cancelled preparation/);
  wait.resolve();
  assert.equal(f.captures.length, 0);
});

test("prepared signal cancellation before consumption prevents protocol invocation", async () => {
  const f = fixture(), a = f.make(), aborter = new AbortController();
  const call = await a.prepareCall(RA, "tools", aborter.signal);
  aborter.abort(new Error("cancelled before consumption"));
  await assert.rejects(collect(call.stream(request())), /cancelled before consumption/);
  assert.equal(f.captures.length, 0);
});

test("stream abort settles even if mock protocol stalls; disposal cancels pending work", async () => {
  const f = fixture({ behavior: { stall: deferred(), captureReady: deferred() } }), a = f.make();
  const aborter = new AbortController();
  const pending = collect(a.stream(request(RA, "tools", { signal: aborter.signal })));
  await f.behavior.captureReady.promise;
  aborter.abort(new Error("cancelled stream"));
  await assert.rejects(pending, /cancelled stream/);
  f.behavior.stall.resolve();
  const second = f.make(B, RB);
  const call = await second.prepareCall(RB, "tools");
  second.dispose(); second.dispose();
  await assert.rejects(collect(call.stream(request(RB))), { code: "ACCOUNT_UNAVAILABLE" });
  await assert.rejects(second.listModels(RB), { code: "ACCOUNT_UNAVAILABLE" });
  assert.throws(() => second.providerInfo(RB), { code: "ACCOUNT_UNAVAILABLE" });
});

test("beforeDispatch gets only the pinned account and validates account again afterward", async () => {
  const f = fixture(), calls = [];
  const a = f.make(A, RA, { beforeDispatch: async (context) => {
    calls.push(context); assert.ok(Object.isFrozen(context));
    await f.credentials.modifyRecord(A, (record) => ({ ...record, payload: { ...record.payload, access: "FAKE_A_PROACTIVE" } }));
  } });
  await a.listModels(RA); assert.equal(calls.length, 0);
  await collect(a.stream(request()));
  assert.equal(calls.length, 1); assert.equal(calls[0].accountId, A); assert.equal(calls[0].routeId, RA);
  assert.equal(f.captures[0].options.apiKey, "FAKE_A_PROACTIVE");
  const unavailable = f.make(B, RB, { beforeDispatch: () => { f.credentials.records.delete(B); } });
  await assert.rejects(collect(unavailable.stream(request(RB))), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal(f.captures.length, 1);
});

test("beforeDispatch cancellation prevents dispatch without waiting for hook completion", async () => {
  const f = fixture(), gate = deferred(), entered = deferred(), aborter = new AbortController();
  const a = f.make(A, RA, { beforeDispatch: async () => { entered.resolve(); await gate.promise; } });
  const pending = collect(a.stream(request(RA, "tools", { signal: aborter.signal })));
  await entered.promise; aborter.abort(new Error("cancelled hook"));
  await assert.rejects(pending, /cancelled hook/); gate.resolve();
  assert.equal(f.captures.length, 0);
});

test("native account auth cannot be bypassed by environment or configured credential headers", async () => {
  const f = fixture();
  assert.throws(() => f.make(A, RA, { profileDefaults: { headers: { Authorization: "FAKE_OTHER" } } }), { code: "ACCOUNT_AUTH_OVERRIDE" });
  const a = f.make(A, RA, { prepareHeaders: (request, headers) => { assert.equal(request.provider, RA); headers.set("X-Test", "safe"); return headers; } });
  await collect(a.stream(request(RA, "tools", { apiKey: "FAKE_OTHER", env: { FAKE: "OTHER" }, auth: { other: true }, headers: { Authorization: "FAKE_OTHER" }, baseUrl: "https://wrong.invalid" })));
  assert.equal(f.captures[0].options.apiKey, "FAKE_A_ACCESS");
  assert.equal(f.captures[0].options.env, undefined);
  assert.equal(f.captures[0].options.auth, undefined);
  assert.equal(f.captures[0].options.baseUrl, "https://copilot-api.company-a.ghe.com");
  assert.equal(f.captures[0].options.headers.get("X-Test"), "safe");
  const b = f.make(B, RB, { prepareHeaders: (request, headers) => { headers.set("x-api-key", "FAKE_OTHER"); return headers; } });
  await assert.rejects(collect(b.stream(request(RB))), { code: "ACCOUNT_AUTH_OVERRIDE" });
});

test("caller consumption stops cleanly and missing runtime/foreign routes fail explicitly", async () => {
  const f = fixture(), a = f.make();
  for await (const chunk of a.stream(request())) { assert.equal(chunk.type, "block-start"); break; }
  // return() cleanup is deliberately detached, so allow its own microtask to run.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.closeCalls.includes("tools"));
  assert.throws(() => a.providerInfo(RB), { code: "NO_ADAPTER" });
  await assert.rejects(a.listModels(RB), { code: "NO_ADAPTER" });
  assert.throws(() => createAccountAdapter(), { code: "ACCOUNT_RUNTIME_UNAVAILABLE" });
  assert.throws(() => f.make(A, NATIVE), { code: "INVALID_ACCOUNT_ROUTE" });
});

test("a dynamic disabled account rejects previously prepared work without changing bindings", async () => {
  const f = fixture(); let enabled = true;
  const a = f.make(A, RA, { isEnabled: async () => enabled });
  const call = await a.prepareCall(RA, "tools");
  enabled = false;
  await assert.rejects(collect(call.stream(request())), { code: "ACCOUNT_UNAVAILABLE" });
  await assert.rejects(a.listModels(RA), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal(f.captures.length, 0);
  assert.equal(a.accountId, A);
});

test("a started refresh persists only its own rotated fake grant after caller cancellation", async () => {
  const service = memory(), store = createAccountCredentialStore({ credentials: service, accountId: A });
  const started = deferred(), release = deferred(), controller = new AbortController();
  const pending = store.modify(NATIVE, async (current) => {
    started.resolve(); await release.promise;
    return { ...current, access: "FAKE_ROTATED_AFTER_ABORT", account: { wrong: true } };
  }, { signal: controller.signal });
  await started.promise; controller.abort(new Error("caller stopped waiting"));
  await assert.rejects(pending, /caller stopped waiting/);
  release.resolve(); await service.modifyRecord(A, () => undefined);
  assert.equal(service.records.get(A).payload.access, "FAKE_ROTATED_AFTER_ABORT");
  assert.equal(service.records.get(A).payload.account.login, "alice");
  assert.equal(service.records.get(B).payload.access, "FAKE_B_ACCESS");
  assert.deepEqual(service.writes, [A]);
});

test("a failed credential read is sanitized and never falls back to another account", async () => {
  const f = fixture();
  f.credentials.readRecord = async () => { throw new Error("FAKE_PRIVATE_DIAGNOSTIC"); };
  const a = f.make();
  await assert.rejects(a.listModels(RA), (error) => error.code === "ACCOUNT_UNAVAILABLE" && !error.message.includes("FAKE_PRIVATE"));
  assert.equal(f.captures.length, 0);
});

const EPOCH_ONE="11111111-1111-4111-8111-111111111111",EPOCH_TWO="22222222-2222-4222-8222-222222222222";
const WIRE_ONE="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",WIRE_TWO="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function scoped(input,epoch=EPOCH_ONE,transportSessionId=WIRE_ONE,extra={}){
  const fields={sessionId:input.sessionId??null,accountId:input.accountId,credentialIdentity:input.credentialIdentity,logicalProvider:input.logicalProvider,model:input.model,
    reasoningEffort:input.reasoningEffort??null,purpose:input.purpose??null,defaultEpoch:input.defaultEpoch??null,apiContext:input.apiContext??null,
    selectionSeq:null,failureSeq:null,contextSeq:null,resetEpoch:null,replayResetEpoch:null,...extra};
  const contextKey=requestContextKey(fields),transportContextKey=requestTransportKey(fields);
  return{transportSessionId,replayEpoch:epoch,contextKey,transportContextKey,cacheMeta:{version:1,trusted:fields.sessionId!==null,...fields,epoch,contextKey,transportContextKey}};
}

test("same legacy slot on another issuer/long grant cannot unwrap copied native replay even without scope hook",async()=>{
  const first=fixture(),a=first.make(A,RA);
  const old=finish(await collect(a.stream(request(RA,"tools",{sessionId:"copied-sid"})))).replayState;
  const second=fixture({credentials:memory({[A]:grant("B")})}),b=second.make(A,RA);
  const output=finish(await collect(b.stream(request(RA,"tools",{sessionId:"copied-sid",messages:[assistant(RA,"tools",old)]})))).replayState;
  assert.notEqual(output.credentialIdentity,old.credentialIdentity);
  assert.equal(second.captures.at(-1).options.messages[0].source.replayState,undefined);
  assert.equal(second.protocolCalls[0].apiKey,"FAKE_B_ACCESS");
});

test("post-auth issuer or long-grant reassignment stops dispatch; short-access-only rotation remains valid",async()=>{
  for(const change of ["issuer","long"]){
    const f=fixture({behavior:{afterAuth:()=>{
      const record=f.credentials.records.get(A);record.payload={...record.payload,...(change==="issuer"?{enterpriseUrl:"other.ghe.com"}:{refresh:"FAKE_OTHER_LONG"})};
    }}});
    await assert.rejects(collect(f.make(A,RA).stream(request(RA,"tools"))),(error)=>error.code==="ACCOUNT_UNAVAILABLE");
    assert.equal(f.protocolCalls.length,0);
  }
  const f=fixture({behavior:{afterAuth:()=>{f.credentials.records.get(A).payload.access="FAKE_NEW_SHORT";}}});
  await collect(f.make(A,RA).stream(request(RA,"tools")));assert.equal(f.protocolCalls.length,1);
});

test("scoped SDK Session UUIDs and header-hook original identity stay isolated across async iteration",async()=>{
  const hooks=[],scopes=[];
  const f=fixture(),a=f.make(A,RA,{requestScope:async(input)=>{
    scopes.push(input);await Promise.resolve();return scoped(input,EPOCH_ONE,input.sessionId==="public-one"?WIRE_ONE:WIRE_TWO);
  },prepareHeaders:(descriptor,headers)=>{
    hooks.push(descriptor);
    for(const key of ["session_id","x-session-id","x-session-affinity","x-client-request-id"])headers.set(key,"WRONG_SHARED_AFFINITY");
    return headers;
  }});
  const one=Object.freeze(request(RA,"tools",{sessionId:"public-one",[ACCOUNT_REQUEST_CONTEXT]:Object.freeze({logicalProvider:GLOBAL_COPILOT_ROUTE,defaultEpoch:"default-one"})}));
  const two=Object.freeze(request(RA,"tools",{sessionId:"public-two"}));
  const [first,second]=await Promise.all([collect(a.stream(one)),collect(a.stream(two))]);
  assert.equal(one.sessionId,"public-one");assert.equal(two.sessionId,"public-two");
  assert.deepEqual(scopes.map((value)=>value.apiContext),["anthropic-messages","anthropic-messages"]);
  assert.ok(hooks.some((value)=>value.provider===GLOBAL_COPILOT_ROUTE&&value.sessionId==="public-one"));
  assert.ok(hooks.some((value)=>value.provider===RA&&value.sessionId==="public-two"));
  const captured=new Map(f.captures.map((value)=>[value.options.sessionId,value]));
  for(const id of [WIRE_ONE,WIRE_TWO]){
    assert.ok(captured.has(id));
    for(const key of ["session_id","x-session-id","x-session-affinity","x-client-request-id"])assert.equal(captured.get(id).options.headers.get(key),id);
    assert.equal(captured.get(id).options[ACCOUNT_REQUEST_CONTEXT],undefined);
  }
  assert.equal(finish(first).replayState.cache.logicalProvider,GLOBAL_COPILOT_ROUTE);
  assert.equal(finish(second).replayState.cache.sessionId,"public-two");
});

test("same-account managed/global-to-alias crypto survives transport-only failure/compaction reset",async()=>{
  const f=fixture();let phase=0;
  const a=f.make(A,RA,{requestScope:async(input)=>scoped(input,EPOCH_ONE,phase===0?WIRE_ONE:WIRE_TWO,{failureSeq:phase===0?null:99,contextSeq:phase===0?null:88})});
  const first=finish(await collect(a.stream(request(RA,"tools",{sessionId:"same-session",[ACCOUNT_REQUEST_CONTEXT]:{logicalProvider:GLOBAL_COPILOT_ROUTE,defaultEpoch:"default-one"}})))).replayState;
  phase=1;
  const history=[request().messages[0],assistant(GLOBAL_COPILOT_ROUTE,"tools",first)];
  await collect(a.stream(request(RA,"tools",{sessionId:"same-session",messages:history})));
  const captured=f.captures.at(-1);
  assert.equal(captured.options.sessionId,WIRE_TWO);
  assert.equal(captured.options.messages[1].source.provider,NATIVE);
  assert.equal(captured.options.messages[1].source.replayState.blocks[0].thinkingSignature,"FAKE_SIGNATURE_FAKE_A_ACCESS");
  assert.deepEqual(first.cache.epoch,EPOCH_ONE);
});

test("new replay epoch after B success drops older A replay, and raw builtin is always foreign",async()=>{
  const f=fixture();let epoch=EPOCH_ONE;
  const a=f.make(A,RA,{requestScope:async(input)=>scoped(input,epoch,epoch===EPOCH_ONE?WIRE_ONE:WIRE_TWO)});
  const first=finish(await collect(a.stream(request(RA,"tools",{sessionId:"s"})))).replayState;
  epoch=EPOCH_TWO;
  await collect(a.stream(request(RA,"tools",{sessionId:"s",messages:[assistant(RA,"tools",first)]})));
  assert.equal(f.captures.at(-1).options.messages[0].source.replayState,undefined);
  epoch=EPOCH_ONE;
  await collect(a.stream(request(RA,"tools",{sessionId:"s",messages:[assistant(NATIVE,"tools",first)]})));
  assert.equal(f.captures.at(-1).options.messages[0].source.replayState,undefined);
  assert.equal(f.captures.at(-1).options.messages[0].source.provider,"copilot-foreign");
});

test("no-SID scope drops native replay and scope failure never falls back to unscoped dispatch",async()=>{
  const f=fixture();const a=f.make(A,RA,{requestScope:async(input)=>scoped(input)});
  const first=finish(await collect(a.stream(request(RA,"tools")))).replayState;
  assert.equal(first.cache.trusted,false);
  await collect(a.stream(request(RA,"tools",{messages:[assistant(RA,"tools",first)]})));
  assert.equal(f.captures.at(-1).options.messages[0].source.replayState,undefined);
  const invalid=f.make(B,RB,{requestScope:async()=>({transportSessionId:"not-a-uuid"})});
  const before=f.protocolCalls.length;
  await assert.rejects(collect(invalid.stream(request(RB))), (error)=>error.code==="ACCOUNT_REQUEST_STATE_UNAVAILABLE");
  assert.equal(f.protocolCalls.length,before);
});
