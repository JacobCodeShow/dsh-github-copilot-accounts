import { test } from "node:test";
import assert from "node:assert/strict";
import { createManagedGlobalAdapter, managedMessagesToAccount } from "../src/managed-global-adapter.mjs";
import { GLOBAL_COPILOT_ROUTE as GLOBAL, accountRouteId } from "../src/account-route-id.mjs";
import { ACCOUNT_REQUEST_CONTEXT, accountRequestContext, withAccountRequestContext } from "../src/account-request-context.mjs";

const A = "copilot-auth/account-a", B = "copilot-auth/account-b", RA = accountRouteId(A), RB = accountRouteId(B);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const copy = (value) => structuredClone(value);
const collect = async (iterable) => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks; };
const request = (extra = {}) => ({ provider: GLOBAL, model: "model", sessionId: "synthetic-session", messages: [], ...extra });
function fixture(options = {}) {
  const resolverCalls = [], preparations = [], streams = [], publications = [];
  const behavior = { ...options.behavior };
  class Base {}
  const makeAlias = (accountId, routeId, letter) => {
    const alias = {
      alive: true, revision: 1, disposed: 0,
      providerInfo(provider) { assert.equal(provider, routeId); return { id: routeId, name: "Account " + letter }; },
      providerRetryPolicy(provider) { assert.equal(provider, routeId); if (!alias.alive) throw new Error("FAKE_DISPOSED_METADATA"); return { account: letter, revision: this.revision }; },
      imageRequestPricing(provider, model) { assert.equal(provider, routeId); return { account: letter, model }; },
      imageRequestTarget(provider, model, image) { assert.equal(provider, routeId); return { width: image.width / 2, height: image.height, maxBytes: letter === "A" ? 100 : 200 }; },
      async listModels(provider) { assert.equal(provider, routeId); if (!alias.alive) throw Object.assign(new Error("account removed"), { code: "ACCOUNT_UNAVAILABLE" }); return [{ provider: routeId, id: "model", name: "Model " + letter, inputModalities: ["text", "image"] }]; },
      async resolveModel(provider, model) { assert.equal(provider, routeId); if (!alias.alive) throw Object.assign(new Error("account removed"), { code: "ACCOUNT_UNAVAILABLE" }); return { provider: routeId, id: model, name: "Model " + letter, context: { contextWindow: 123000 }, reasoning: { efforts: [{ id: "high", name: "High" }] }, capability: { account: letter } }; },
      async prepareCall(provider, model, signal) {
        assert.equal(provider, routeId); signal?.throwIfAborted();
        if (!alias.alive) throw Object.assign(new Error("account removed"), { code: "ACCOUNT_UNAVAILABLE" });
        const revision = alias.revision; preparations.push({ accountId, routeId, revision });
        return { model: await alias.resolveModel(provider, model), stream: (input) => streamFor(input, revision) };
      },
      stream(input) { return streamFor(input, alias.revision); },
      dispose() { alias.disposed++; alias.alive = false; },
    };
    function streamFor(input, revision) {
      return (async function* () {
        if (!alias.alive) throw Object.assign(new Error("account removed"), { code: "ACCOUNT_UNAVAILABLE" });
        const scope = accountRequestContext(input);
        streams.push({ accountId, routeId, letter, revision, input, scope, messages: copy(input.messages) });
        behavior.streamEntered?.resolve();
        if (behavior.streamGate) await behavior.streamGate.promise; // deliberately ignores abort
        yield { type: "text-delta", index: 0, text: letter + revision };
        const finish = { type: "finish", reason: { kind: "stop" }, replayState: {
          kind: "copilot-account", version: 1, accountId: behavior.outputAccount ?? accountId,
          native: { response: { kind: "pi-ai", version: 2, provider: "github-copilot", model: "model" }, blocks: [{ type: "reasoning", thinkingSignature: "FAKE_" + letter + "_SIGNATURE" }] },
          cache: { version: 1, epoch: scope?.defaultEpoch ?? "bound", contextKey: `${letter}-${scope?.defaultEpoch ?? "bound"}`, purpose: "agent-loop" },
        } };
        alias.lastFinish = finish;
        yield finish;
      })();
    }
    Object.defineProperties(alias, { routeId: { value: routeId }, accountId: { value: accountId } });
    return alias;
  };
  const a = makeAlias(A, RA, "A"), b = makeAlias(B, RB, "B");
  const snapshot = (letter, epoch) => ({ accountId: letter === "A" ? A : B, routeId: letter === "A" ? RA : RB, adapter: letter === "A" ? a : b, defaultEpoch: epoch });
  const state = { value: options.unavailableInitial ? undefined : snapshot("A", "epoch-a1"), gate: undefined, entered: undefined, error: undefined };
  const resolveDefault = async () => {
    const value = state.value, gate = state.gate, error = state.error;
    resolverCalls.push(value); state.entered?.resolve();
    if (gate) await gate.promise;
    if (error) throw error;
    return value;
  };
  const initialize = () => createManagedGlobalAdapter({ LlmAdapter: Base, resolveDefault, onPublish: (event) => {
    publications.push({ event, retry: event.adapter.providerRetryPolicy(GLOBAL), info: event.adapter.providerInfo(GLOBAL) });
    return behavior.onPublish?.(event);
  } });
  return { a, b, state, snapshot, resolveDefault, initialize, behavior, resolverCalls, preparations, streams, publications, Base };
}
const assistant = (provider, replayState) => ({ role: "assistant", content: [{ type: "reasoning", text: "history" }], source: { kind: "model", provider, model: "model", replayState } });

// The cache manager owns epoch validity, not this router. These tests inspect the
// exact private scope it will receive rather than claiming native cache behavior.
test("A to B to A carries captured default epochs without mutating public session/options", async () => {
  const f = fixture(), router = await f.initialize();
  assert.ok(router instanceof f.Base); assert.equal(router.routeId, GLOBAL);
  assert.equal(router.providerInfo(GLOBAL).name, "GitHub Copilot");
  const frozen = Object.freeze(request({ messages: Object.freeze([]) }));
  const first = await collect((await router.prepareCall(GLOBAL, "model")).stream(frozen));
  const firstReplay = first.at(-1).replayState;
  f.state.value = f.snapshot("B", "epoch-b2"); await router.refreshDefault();
  const foreignHistory = Object.freeze(request({ messages: Object.freeze([Object.freeze(assistant(GLOBAL, firstReplay))]) }));
  await collect((await router.prepareCall(GLOBAL, "model")).stream(foreignHistory));
  f.state.value = f.snapshot("A", "epoch-a3"); await router.refreshDefault();
  await collect((await router.prepareCall(GLOBAL, "model")).stream(foreignHistory));
  assert.deepEqual(f.streams.map((call) => call.accountId), [A, B, A]);
  assert.deepEqual(f.streams.map((call) => call.scope), [
    { logicalProvider: GLOBAL, defaultEpoch: "epoch-a1" }, { logicalProvider: GLOBAL, defaultEpoch: "epoch-b2" }, { logicalProvider: GLOBAL, defaultEpoch: "epoch-a3" },
  ]);
  assert.ok(f.streams.every((call) => call.input.sessionId === "synthetic-session"));
  assert.equal(f.streams[1].messages[0].source.provider, GLOBAL);
  assert.equal(f.streams[1].messages[0].source.replayState, undefined, "B never receives A's native signatures");
  assert.equal(f.streams[2].messages[0].source.provider, RA);
  assert.deepEqual(f.streams[2].messages[0].source.replayState, firstReplay, "contiguous-account/cache validity is delegated, no router cache or crypto rewrite");
  assert.equal(f.streams[2].scope.defaultEpoch, "epoch-a3");
  assert.equal(firstReplay.cache.epoch, "epoch-a1");
  assert.equal(frozen.provider, GLOBAL); assert.equal(frozen[ACCOUNT_REQUEST_CONTEXT], undefined);
  assert.equal(foreignHistory.messages[0].source.provider, GLOBAL);
  router.dispose(); assert.equal(f.a.disposed, 0); assert.equal(f.b.disposed, 0);
});

test("prepare resolves the known default once and pins account plus alias profile call", async () => {
  const f = fixture(), router = await f.initialize(), before = f.resolverCalls.length;
  const call = await router.prepareCall(GLOBAL, "model");
  assert.equal(f.resolverCalls.length, before + 1);
  f.state.value = f.snapshot("B", "epoch-b2"); f.a.revision = 2;
  const output = await collect(call.stream(request()));
  assert.equal(f.resolverCalls.length, before + 1, "prepared stream never re-resolves global default");
  assert.equal(output[0].text, "A1"); assert.equal(f.streams[0].input.provider, RA);
  assert.equal(f.streams[0].scope.defaultEpoch, "epoch-a1");
  assert.equal(output.at(-1), f.a.lastFinish, "finish replay/cache fields forwarded unchanged");
  const next = await router.prepareCall(GLOBAL, "model"); await collect(next.stream(request()));
  assert.equal(f.streams[1].accountId, B);
  router.dispose();
});

test("managed and exact-alias same-account provenance survives; builtin/foreign alias/account replay strips", () => {
  const own = { kind: "copilot-account", version: 1, accountId: A, native: { signature: "FAKE_A" }, cache: { epoch: "older" } };
  const raw = { response: { kind: "pi-ai", provider: "github-copilot", model: "model" }, blocks: [{ thinkingSignature: "FAKE_RAW" }] };
  const messages = [assistant(GLOBAL, own), assistant(GLOBAL, { ...own, accountId: B }), assistant("github-copilot", raw), assistant("github-copilot", own), assistant(RA, own), assistant(RB, { ...own, accountId: B }), assistant(GLOBAL, raw)];
  const before = copy(messages), result = managedMessagesToAccount(messages, { accountId: A, routeId: RA });
  assert.equal(result[0].source.provider, RA); assert.deepEqual(result[0].source.replayState, own);
  assert.equal(result[4].source.provider, RA);
  assert.deepEqual(result[4].source.replayState, own, "bound A to managed A retains proven crypto for request-state validation");
  for (const index of [1, 2, 3, 5, 6]) assert.equal(result[index].source.replayState, undefined);
  const spoofedAlias = managedMessagesToAccount([assistant(RB, own)], { accountId: A, routeId: RA });
  assert.equal(spoofedAlias[0].source.replayState, undefined, "matching account field alone cannot authorize an unrelated alias source");
  assert.deepEqual(messages, before);
});

test("bound A to managed A forwards proven crypto and independent managed transport scope", async () => {
  const f = fixture(), router = await f.initialize();
  const bound = await collect(f.a.stream({ provider: RA, model: "model", messages: [], sessionId: "synthetic-session" }));
  const envelope = bound.at(-1).replayState;
  const ownAliasHistory = assistant(RA, envelope);
  await collect((await router.prepareCall(GLOBAL, "model")).stream(request({ messages: [ownAliasHistory] })));
  const received = f.streams.at(-1);
  assert.equal(received.messages[0].source.provider, RA);
  assert.deepEqual(received.messages[0].source.replayState, envelope, "router does not erase valid same-account signatures because only logical route changed");
  assert.equal(received.messages[0].source.replayState.cache.epoch, "bound");
  assert.deepEqual(received.scope, { logicalProvider: GLOBAL, defaultEpoch: "epoch-a1" }, "request-state manager decides transport partition separately");
  router.dispose(); assert.equal(f.a.disposed, 0);
});

test("list/resolve expose current-default caps through logical provider, sync helpers publish eagerly", async () => {
  const f = fixture(), router = await f.initialize();
  assert.deepEqual(router.providerRetryPolicy(GLOBAL), { account: "A", revision: 1 });
  assert.deepEqual(router.imageRequestPricing(GLOBAL, "model"), { account: "A", model: "model" });
  assert.deepEqual(router.imageRequestTarget(GLOBAL, "model", { width: 100, height: 50 }), { width: 50, height: 50, maxBytes: 100 });
  let count = f.resolverCalls.length;
  assert.equal((await router.listModels(GLOBAL))[0].provider, GLOBAL); assert.equal(f.resolverCalls.length, ++count);
  const info = await router.resolveModel(GLOBAL, "model"); assert.equal(f.resolverCalls.length, ++count);
  assert.equal(info.provider, GLOBAL); assert.equal(info.context.contextWindow, 123000); assert.equal(info.capability.account, "A");
  f.state.value = f.snapshot("B", "epoch-b2");
  assert.equal(await router.refreshDefault(), true);
  assert.deepEqual(f.publications[0].retry, { account: "B", revision: 1 });
  assert.equal(f.publications[0].event.accountId, B); assert.ok(Object.isFrozen(f.publications[0].event));
  assert.equal(f.publications[0].info.id, GLOBAL); assert.equal(router.defaultEpoch, "epoch-b2");
  assert.equal((await router.resolveModel(GLOBAL, "model")).capability.account, "B");
  router.dispose();
});

test("unknown initial default stays registered but requests fail closed without legacy/env fallback", async () => {
  const f = fixture({ unavailableInitial: true }), router = await f.initialize();
  assert.deepEqual(router.providerInfo(GLOBAL), { id: GLOBAL, name: "GitHub Copilot" });
  assert.equal(router.defaultError.code, "ACCOUNT_UNAVAILABLE"); assert.equal(router.providerRetryPolicy(GLOBAL), undefined);
  assert.equal(router.imageRequestPricing(GLOBAL, "model"), undefined);
  assert.throws(() => router.imageRequestTarget(GLOBAL, "model", { width: 1, height: 1 }), { code: "ACCOUNT_UNAVAILABLE" });
  await assert.rejects(router.prepareCall(GLOBAL, "model"), { code: "ACCOUNT_UNAVAILABLE" });
  await assert.rejects(router.resolveModel(GLOBAL, "model"), { code: "ACCOUNT_UNAVAILABLE" });
  await assert.rejects(router.listModels(GLOBAL), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal(f.preparations.length, 0); assert.equal(f.streams.length, 0);
  f.state.value = f.snapshot("A", "epoch-a1"); await router.refreshDefault();
  assert.equal(router.defaultError, undefined);
  await collect(router.stream(request())); assert.equal(f.streams[0].accountId, A);
  router.dispose();
});

test("override/unmatched/missing/malformed resolver snapshots never authenticate an inferred account", async () => {
  const f = fixture(), router = await f.initialize();
  for (const value of [undefined, null, {}, { ...f.snapshot("A", "e"), apiKeyOverride: true }, { ...f.snapshot("A", "e"), oauthMatched: false }, { ...f.snapshot("A", "e"), recordMissing: true }, { ...f.snapshot("A", "e"), unavailable: true }, { ...f.snapshot("A", "e"), available: false }, { ...f.snapshot("A", "e"), defaultEpoch: undefined }, { ...f.snapshot("A", "e"), routeId: RB }, { ...f.snapshot("A", "e"), adapter: f.b }]) {
    f.state.value = value;
    await assert.rejects(router.prepareCall(GLOBAL, "model"), { code: "ACCOUNT_UNAVAILABLE" });
  }
  f.state.error = new Error("FAKE_PRIVATE_URL?secret=hidden");
  await assert.rejects(router.prepareCall(GLOBAL, "model"), (error) => error.code === "ACCOUNT_UNAVAILABLE" && !error.message.includes("PRIVATE") && error.cause === undefined);
  assert.equal(f.preparations.length, 0); assert.equal(f.streams.length, 0);
  router.dispose();
});

test("post-prepare deleted captured account fails on its delegate rather than switching defaults", async () => {
  const f = fixture(), router = await f.initialize(), call = await router.prepareCall(GLOBAL, "model");
  const resolutions = f.resolverCalls.length;
  f.a.alive = false; f.state.value = f.snapshot("B", "epoch-b2");
  await assert.rejects(collect(call.stream(request())), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal(f.resolverCalls.length, resolutions); assert.equal(f.streams.length, 0);
  router.dispose();
});

test("caller overrides, wrong provider/model and foreign outgoing account envelope are refused", async () => {
  const f = fixture(), router = await f.initialize(), call = await router.prepareCall(GLOBAL, "model");
  for (const extra of [{ apiKey: "FAKE_OVERRIDE" }, { env: { FAKE: "override" } }, { headers: {} }]) assert.throws(() => call.stream(request(extra)), { code: "ACCOUNT_UNAVAILABLE" });
  assert.throws(() => call.stream(request({ provider: RA })), { code: "NO_ADAPTER" });
  assert.throws(() => call.stream(request({ model: "other" })), { code: "PREPARED_CALL_MISMATCH" });
  await assert.rejects(router.prepareCall(RA, "model"), { code: "NO_ADAPTER" });
  f.behavior.outputAccount = B;
  await assert.rejects(collect(call.stream(request())), { code: "ACCOUNT_REPLAY_INVALID" });
  router.dispose();
});

test("request scope is frozen, enumerable-symbol private metadata and stale caller context is replaced", async () => {
  const original = Object.freeze(request()), context = { logicalProvider: GLOBAL, defaultEpoch: "e1" };
  const attached = withAccountRequestContext(original, context);
  assert.notEqual(attached, original); assert.equal(original[ACCOUNT_REQUEST_CONTEXT], undefined);
  assert.ok(Object.isFrozen(attached[ACCOUNT_REQUEST_CONTEXT])); assert.equal(Object.getOwnPropertyDescriptor(attached, ACCOUNT_REQUEST_CONTEXT).enumerable, true);
  assert.equal(JSON.stringify(attached).includes("defaultEpoch"), false);
  assert.deepEqual(accountRequestContext({ ...attached }), context);
  assert.equal(accountRequestContext({ [ACCOUNT_REQUEST_CONTEXT]: { logicalProvider: GLOBAL } }), undefined);
  assert.throws(() => withAccountRequestContext(original, { logicalProvider: GLOBAL, defaultEpoch: NaN }), TypeError);
  const f = fixture(), router = await f.initialize();
  const forged = withAccountRequestContext(request(), { logicalProvider: "foreign", defaultEpoch: "stale" });
  await collect((await router.prepareCall(GLOBAL, "model")).stream(Object.freeze(forged)));
  assert.deepEqual(f.streams[0].scope, { logicalProvider: GLOBAL, defaultEpoch: "epoch-a1" });
  router.dispose();
});

test("cancellation while resolving prevents alias preparation, and prepared signal remains effective", async () => {
  const f = fixture(), router = await f.initialize(), entered = deferred(), gate = deferred(), controller = new AbortController();
  f.state.gate = gate; f.state.entered = entered;
  const pending = router.prepareCall(GLOBAL, "model", controller.signal); await entered.promise;
  controller.abort(new Error("cancelled default resolution")); await assert.rejects(pending, /cancelled default resolution/);
  gate.resolve(); f.state.gate = undefined; f.state.entered = undefined;
  assert.equal(f.preparations.length, 0);
  const stop = new AbortController(), call = await router.prepareCall(GLOBAL, "model", stop.signal);
  stop.abort(new Error("cancelled prepared default")); assert.throws(() => call.stream(request()), /cancelled prepared default/);
  assert.equal(f.streams.length, 0); router.dispose();
});

test("router disposal aborts pending streams but never disposes registry-owned aliases", async () => {
  const gate = deferred(), entered = deferred(), f = fixture({ behavior: { streamGate: gate, streamEntered: entered } }), router = await f.initialize();
  const pending = collect((await router.prepareCall(GLOBAL, "model")).stream(request())); await entered.promise;
  router.dispose(); router.dispose(); await assert.rejects(pending, { code: "ACCOUNT_UNAVAILABLE" });
  gate.resolve(); f.behavior.streamGate = undefined;
  assert.equal(f.a.disposed, 0); assert.equal(f.b.disposed, 0);
  const bound = await collect(f.a.stream({ provider: RA, model: "model", messages: [] }));
  assert.equal(bound[0].text, "A1", "bound sessions survive router disposal");
  await assert.rejects(router.listModels(GLOBAL), { code: "ACCOUNT_UNAVAILABLE" });
});

test("stale eager metadata refresh cannot overwrite newer default epoch", async () => {
  const f = fixture(), router = await f.initialize(), gate = deferred(), entered = deferred();
  f.state.value = f.snapshot("B", "epoch-b2"); f.state.gate = gate; f.state.entered = entered;
  const old = router.refreshDefault(); await entered.promise;
  f.state.value = f.snapshot("A", "epoch-a3"); f.state.gate = undefined; f.state.entered = undefined;
  await router.refreshDefault(); gate.resolve(); await old;
  assert.equal(router.defaultEpoch, "epoch-a3"); assert.equal(f.publications.length, 1);
  assert.deepEqual(router.providerRetryPolicy(GLOBAL), { account: "A", revision: 1 }); router.dispose();
});

test("delete-current-default invalidation keeps global registry metadata serviceable and B alive", async () => {
  const f = fixture(), router = await f.initialize();
  assert.equal(router.invalidateDefault(B), false, "unrelated account removal does not clear a known A default");
  assert.equal(router.defaultEpoch, "epoch-a1");
  assert.equal(router.invalidateDefault(A), true);
  assert.equal(router.defaultEpoch, undefined); assert.equal(router.defaultError.code, "ACCOUNT_UNAVAILABLE");
  f.a.dispose(); f.state.value = undefined; // Registry removal/tombstone, not router ownership.
  assert.deepEqual(router.providerInfo(GLOBAL), { id: GLOBAL, name: "GitHub Copilot" });
  assert.equal(router.providerRetryPolicy(GLOBAL), undefined);
  assert.equal(await router.refreshDefault(), false);
  assert.equal(f.publications.at(-1).event.available, false);
  assert.equal(f.publications.at(-1).retry, undefined, "root hub can validate remaining GLOBAL+B metadata without a default");
  assert.deepEqual(f.b.providerRetryPolicy(RB), { account: "B", revision: 1 });
  await assert.rejects(router.prepareCall(GLOBAL, "model"), { code: "ACCOUNT_UNAVAILABLE" });
  router.dispose(); assert.equal(f.a.disposed, 1); assert.equal(f.b.disposed, 0);
  assert.equal(router.providerRetryPolicy(GLOBAL), undefined, "teardown metadata never dereferences a disposed alias");
  assert.equal(router.providerInfo(GLOBAL).id, GLOBAL);
  const defensive = fixture(), second = await defensive.initialize();
  defensive.a.dispose();
  assert.equal(second.providerRetryPolicy(GLOBAL), undefined, "missing explicit invalidation still cannot block root replacement");
  assert.equal(second.defaultError.code, "ACCOUNT_UNAVAILABLE"); assert.equal(second.defaultEpoch, undefined);
  second.dispose(); assert.equal(defensive.a.disposed, 1); assert.equal(defensive.b.disposed, 0);
});

test("synchronous invalidation discards in-flight eager default metadata completion", async () => {
  const f = fixture(), router = await f.initialize(), gate = deferred(), entered = deferred();
  f.state.gate = gate; f.state.entered = entered;
  const pending = router.refreshDefault(); await entered.promise;
  assert.equal(router.invalidateDefault(A), true);
  f.state.value = undefined; f.a.dispose(); gate.resolve(); await pending;
  assert.equal(router.defaultEpoch, undefined); assert.equal(router.defaultError.code, "ACCOUNT_UNAVAILABLE");
  assert.equal(f.publications.length, 0, "stale deleted-account capture is never re-published");
  assert.equal(f.a.disposed, 1); assert.equal(f.b.disposed, 0); router.dispose();
});

test("metadata publication rollback blocks new calls without revoking an old prepared account", async () => {
  const f = fixture(), router = await f.initialize(), call = await router.prepareCall(GLOBAL, "model");
  f.state.value = f.snapshot("B", "epoch-b2"); f.behavior.onPublish = () => { throw new Error("FAKE_PRIVATE_PUBLICATION"); };
  await assert.rejects(router.refreshDefault(), (error) => error.code === "ACCOUNT_UNAVAILABLE" && !error.message.includes("PRIVATE"));
  assert.deepEqual(router.providerRetryPolicy(GLOBAL), { account: "A", revision: 1 });
  await assert.rejects(router.prepareCall(GLOBAL, "model"), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal((await collect(call.stream(request())))[0].text, "A1");
  f.behavior.onPublish = undefined; await router.refreshDefault();
  assert.equal((await collect(router.stream(request())))[0].text, "B1");
  router.dispose(); assert.equal(f.a.disposed, 0); assert.equal(f.b.disposed, 0);
});
