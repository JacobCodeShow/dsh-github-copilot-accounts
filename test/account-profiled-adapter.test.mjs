import { test } from "node:test";
import assert from "node:assert/strict";
import { createProfiledAccountAdapter } from "../src/account-profiled-adapter.mjs";

const A = "copilot-auth/account-a", RA = "copilot-account-a", B = "copilot-auth/account-b", RB = "copilot-account-b";
const clone = (value) => structuredClone(value);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const collect = async (iterable) => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks; };
const request = (provider = RA, extra = {}) => ({ provider, model: "model", messages: [], ...extra });
function fixture({ accountId = A, routeId = RA, specs = new Map(), onPublish } = {}) {
  const delegates = new Map(), inputs = [], publications = [], created = new Map(), revoked = new Map();
  class Base {}
  const signalFor = (map, revision) => { if (!map.has(revision)) map.set(revision, deferred()); return map.get(revision); };
  const createDelegate = async (profile) => {
    inputs.push(profile);
    const revision = profile.revision, spec = specs.get(revision) ?? {};
    if (spec.buildGate) await spec.buildGate.promise;
    if (spec.error) throw new Error("FAKE_PRIVATE_CONFIG_VALUE");
    if (spec.foreign) return spec.foreign;
    const metadata = () => ({ provider: routeId, id: "model", name: `Model ${revision}`, context: { contextWindow: 1000 + revision }, capability: { revision } });
    const calls = [];
    const streamFor = (options) => {
      calls.push({ method: "stream", revision, options });
      return (async function* () {
        if (spec.streamEntered) spec.streamEntered.resolve();
        if (spec.streamGate) await spec.streamGate.promise; // deliberately ignores abort
        yield { type: "text-delta", index: 0, text: String(revision) };
        yield { type: "finish", reason: { kind: "stop" }, replayState: { kind: "copilot-account", version: 1, accountId, native: { revision } } };
      })();
    };
    const delegate = {
      revision, disposed: 0, calls,
      providerInfo(provider) { assert.equal(provider, routeId); return { id: spec.badInfo ? "wrong" : routeId, name: `Profile ${revision}` }; },
      providerRetryPolicy(provider) { assert.equal(provider, routeId); return { generation: revision }; },
      imageRequestPricing(provider, model) { assert.equal(provider, routeId); return { model, revision }; },
      imageRequestTarget(provider, model, image) { assert.equal(provider, routeId); return { width: image.width / revision, height: image.height, maxBytes: revision }; },
      async listModels(provider) { calls.push({ method: "list", revision }); assert.equal(provider, routeId); if (spec.listGate) await spec.listGate.promise; return [metadata()]; },
      async resolveModel(provider, model) { calls.push({ method: "resolve", revision }); assert.equal(provider, routeId); assert.equal(model, "model"); if (spec.resolveGate) await spec.resolveGate.promise; return metadata(); },
      async prepareCall(provider, model) {
        calls.push({ method: "prepare", revision }); assert.equal(provider, routeId); assert.equal(model, "model");
        const info = metadata(); if (spec.prepareGate) await spec.prepareGate.promise;
        return { model: info, stream: streamFor };
      },
      stream: streamFor,
      dispose() { this.disposed++; signalFor(revoked, revision).resolve(); if (spec.disposeThrows) throw new Error("FAKE_PRIVATE_DISPOSAL"); },
    };
    Object.defineProperties(delegate, { routeId: { value: routeId }, accountId: { value: accountId } });
    delegates.set(revision, delegate); signalFor(created, revision).resolve(delegate);
    return delegate;
  };
  const initialize = (initialProfile = { revision: 1 }) => createProfiledAccountAdapter({ LlmAdapter: Base, createDelegate, initialProfile, routeId, accountId,
    onPublish: (event) => {
      publications.push({ event, info: event.adapter.providerInfo(routeId), retry: event.adapter.providerRetryPolicy(routeId) });
      return onPublish?.(event);
    } });
  return { initialize, delegates, inputs, publications, specs, created: (revision) => signalFor(created, revision).promise, revoked: (revision) => signalFor(revoked, revision).promise, Base, createDelegate };
}

test("initialized stable proxy forwards live metadata and publishes retry facts synchronously", async () => {
  const f = fixture(), proxy = await f.initialize();
  assert.ok(proxy instanceof f.Base);
  assert.equal(f.publications.length, 0, "initial registration is caller-owned");
  assert.equal(proxy.accountId, A); assert.equal(proxy.routeId, RA); assert.equal(proxy.generation, 1);
  assert.throws(() => { proxy.accountId = B; }, TypeError);
  assert.equal(proxy.providerInfo(RA).name, "Profile 1");
  assert.deepEqual(proxy.providerRetryPolicy(RA), { generation: 1 });
  assert.deepEqual(proxy.imageRequestPricing(RA, "model"), { model: "model", revision: 1 });
  assert.deepEqual(proxy.imageRequestTarget(RA, "model", { width: 100, height: 50 }), { width: 100, height: 50, maxBytes: 1 });
  const identity = proxy;
  assert.equal(await proxy.updateProfile({ revision: 2 }), true);
  assert.equal(proxy, identity); assert.equal(proxy.generation, 2);
  assert.equal(f.publications.length, 1); assert.ok(Object.isFrozen(f.publications[0].event));
  assert.equal(f.publications[0].event.adapter, proxy);
  assert.equal(f.publications[0].info.name, "Profile 2");
  assert.deepEqual(f.publications[0].retry, { generation: 2 });
  assert.equal(f.delegates.get(1).disposed, 0, "normal publication retains old prepared generations");
  assert.deepEqual((await proxy.listModels(RA)).map((model) => model.name), ["Model 2"]);
  assert.equal((await proxy.resolveModel(RA, "model")).context.contextWindow, 1002);
  await proxy.dispose();
});

test("prepare/resolve/list capture the current delegate before any await", async () => {
  const spec = { prepareGate: deferred(), resolveGate: deferred(), listGate: deferred() };
  const f = fixture({ specs: new Map([[1, spec]]) }), proxy = await f.initialize();
  const prepared = proxy.prepareCall(RA, "model"), resolved = proxy.resolveModel(RA, "model"), listed = proxy.listModels(RA);
  assert.deepEqual(f.delegates.get(1).calls.map((call) => call.method), ["prepare", "resolve", "list"]);
  await proxy.updateProfile({ revision: 2 });
  spec.prepareGate.resolve(); spec.resolveGate.resolve(); spec.listGate.resolve();
  const [call, info, models] = await Promise.all([prepared, resolved, listed]);
  assert.equal(call.model.capability.revision, 1); assert.equal(info.capability.revision, 1); assert.equal(models[0].capability.revision, 1);
  const chunks = await collect(call.stream(request()));
  assert.equal(chunks[0].text, "1");
  assert.deepEqual(chunks.at(-1).replayState, { kind: "copilot-account", version: 1, accountId: A, native: { revision: 1 } });
  assert.equal((await proxy.prepareCall(RA, "model")).model.capability.revision, 2);
  assert.equal(f.delegates.get(1).disposed, 0);
  await proxy.dispose();
});

test("direct stream captures on method invocation, not deferred iterator consumption", async () => {
  const f = fixture(), proxy = await f.initialize();
  const started = proxy.stream(request());
  await proxy.updateProfile({ revision: 2 });
  assert.equal((await collect(started))[0].text, "1");
  assert.equal((await collect(proxy.stream(request())))[0].text, "2");
  await proxy.dispose();
});

test("failed latest build blocks new request methods but old started/prepared calls finish", async () => {
  const f = fixture({ specs: new Map([[2, { error: true }]]) }), proxy = await f.initialize();
  const prepared = await proxy.prepareCall(RA, "model"), started = proxy.stream(request());
  await assert.rejects(proxy.updateProfile({ revision: 2 }), (error) => error.code === "ACCOUNT_PROFILE_INVALID" && !error.message.includes("PRIVATE") && error.cause === undefined);
  assert.equal(proxy.profileError.code, "ACCOUNT_PROFILE_INVALID");
  await assert.rejects(proxy.prepareCall(RA, "model"), { code: "ACCOUNT_PROFILE_INVALID" });
  await assert.rejects(proxy.resolveModel(RA, "model"), { code: "ACCOUNT_PROFILE_INVALID" });
  await assert.rejects(proxy.listModels(RA), { code: "ACCOUNT_PROFILE_INVALID" });
  assert.throws(() => proxy.stream(request()), { code: "ACCOUNT_PROFILE_INVALID" });
  assert.equal(proxy.providerInfo(RA).name, "Profile 1", "sync registered facts remain the published generation");
  assert.equal((await collect(prepared.stream(request())))[0].text, "1");
  assert.equal((await collect(started))[0].text, "1");
  assert.equal(await proxy.updateProfile({ revision: 3 }), true);
  assert.equal(proxy.profileError, undefined);
  assert.equal((await collect(proxy.stream(request())))[0].text, "3");
  await proxy.dispose();
});

test("last-started build wins; an older successful candidate is disposed, not published", async () => {
  const gate = deferred(), f = fixture({ specs: new Map([[2, { buildGate: gate }]]) }), proxy = await f.initialize();
  const old = proxy.updateProfile({ revision: 2 }), latest = proxy.updateProfile({ revision: 3 });
  assert.equal(await latest, true);
  gate.resolve(); assert.equal(await old, false);
  assert.equal(proxy.providerInfo(RA).name, "Profile 3");
  assert.equal(f.delegates.get(2).disposed, 1); assert.equal(f.delegates.get(1).disposed, 0);
  assert.deepEqual(f.publications.map((value) => value.info.name), ["Profile 3"]);
  await proxy.dispose();
});

test("outdated failure never poisons newer success, and older success cannot heal latest failure", async () => {
  const oldGate = deferred(), f = fixture({ specs: new Map([[2, { buildGate: oldGate, error: true }], [4, { error: true }], [5, { buildGate: deferred() }]]) }), proxy = await f.initialize();
  const oldFailure = proxy.updateProfile({ revision: 2 });
  await proxy.updateProfile({ revision: 3 }); oldGate.resolve();
  assert.equal(await oldFailure, false); assert.equal(proxy.profileError, undefined);
  const pendingOlder = proxy.updateProfile({ revision: 5 });
  await assert.rejects(proxy.updateProfile({ revision: 4 }), { code: "ACCOUNT_PROFILE_INVALID" });
  f.specs.get(5).buildGate.resolve();
  assert.equal(await pendingOlder, false);
  assert.equal(proxy.profileError.code, "ACCOUNT_PROFILE_INVALID");
  assert.equal(proxy.providerInfo(RA).name, "Profile 3");
  await proxy.dispose();
});

test("publication callback sees candidate then rollback restores old metadata and prepared streams", async () => {
  const f = fixture({ onPublish: (event) => { if (event.adapter.providerInfo(RA).name === "Profile 2") throw new Error("FAKE_PRIVATE_REGISTRY_ERROR"); } });
  const proxy = await f.initialize(), prepared = await proxy.prepareCall(RA, "model");
  await assert.rejects(proxy.updateProfile({ revision: 2 }), { code: "ACCOUNT_PROFILE_INVALID" });
  assert.equal(f.publications[0].info.name, "Profile 2");
  assert.equal(proxy.providerInfo(RA).name, "Profile 1"); assert.equal(proxy.generation, 1);
  assert.deepEqual(proxy.providerRetryPolicy(RA), { generation: 1 });
  assert.equal(f.delegates.get(2).disposed, 1); assert.equal(f.delegates.get(1).disposed, 0);
  assert.equal((await collect(prepared.stream(request())))[0].text, "1");
  await proxy.updateProfile({ revision: 3 });
  assert.equal(proxy.profileError, undefined); assert.equal(proxy.generation, 3);
  await proxy.dispose();
});

test("reentrant newer update prevents a failed publication from corrupting its state", async () => {
  const gate = deferred(); let proxy, newer;
  const f = fixture({ specs: new Map([[2, { error: true }], [4, { buildGate: gate }]]), onPublish: (event) => {
    if (event.adapter.providerInfo(RA).name === "Profile 3") { newer = proxy.updateProfile({ revision: 4 }); throw new Error("FAKE_PRIVATE"); }
  } });
  proxy = await f.initialize();
  await assert.rejects(proxy.updateProfile({ revision: 2 }), { code: "ACCOUNT_PROFILE_INVALID" });
  assert.equal(await proxy.updateProfile({ revision: 3 }), false);
  assert.equal(proxy.profileError.code, "ACCOUNT_PROFILE_INVALID", "rollback retains previous blocked state while newer build is pending");
  gate.resolve(); assert.equal(await newer, true);
  assert.equal(proxy.profileError, undefined); assert.equal(proxy.providerInfo(RA).name, "Profile 4");
  await proxy.dispose();
});

test("async publication callbacks are rejected rather than mixing registration generations", async () => {
  const f = fixture({ onPublish: () => Promise.reject(new Error("FAKE_ASYNC_PRIVATE")) }), proxy = await f.initialize();
  await assert.rejects(proxy.updateProfile({ revision: 2 }), { code: "ACCOUNT_PROFILE_INVALID" });
  assert.equal(proxy.providerInfo(RA).name, "Profile 1"); assert.equal(f.delegates.get(2).disposed, 1);
  await proxy.dispose();
});

test("profile inputs and returned model metadata are detached", async () => {
  const initial = { revision: 1, nested: { retained: true } }, gate = deferred();
  const f = fixture({ specs: new Map([[2, { buildGate: gate }]]) }), proxy = await f.initialize(initial);
  assert.notEqual(f.inputs[0], initial); assert.deepEqual(f.inputs[0], initial);
  const profile = { revision: 2, nested: { retained: true } }, pending = proxy.updateProfile(profile);
  profile.revision = 99; profile.nested.retained = false;
  assert.equal(f.inputs[1].revision, 2); assert.equal(f.inputs[1].nested.retained, true);
  gate.resolve(); await pending;
  const info = await proxy.resolveModel(RA, "model"); info.capability.revision = 999;
  assert.equal((await proxy.resolveModel(RA, "model")).capability.revision, 2);
  await assert.rejects(proxy.updateProfile({ cannotClone() {} }), { code: "ACCOUNT_PROFILE_INVALID" });
  await proxy.dispose();
});

test("A/B proxies are independent and an invalid foreign candidate never revokes B", async () => {
  const fb = fixture({ accountId: B, routeId: RB }), b = await fb.initialize({ revision: 10 });
  const fa = fixture({ specs: new Map([[2, { foreign: fb.delegates.get(10) }]]) }), a = await fa.initialize();
  await assert.rejects(a.updateProfile({ revision: 2 }), { code: "ACCOUNT_PROFILE_INVALID" });
  assert.equal(fb.delegates.get(10).disposed, 0);
  assert.equal(b.profileError, undefined); assert.equal((await collect(b.stream(request(RB))))[0].text, "10");
  assert.throws(() => a.providerInfo(RB), { code: "NO_ADAPTER" });
  await assert.rejects(a.listModels(RB), { code: "NO_ADAPTER" });
  await a.dispose(); assert.equal(fb.delegates.get(10).disposed, 0);
  await b.dispose(); assert.equal(fb.delegates.get(10).disposed, 1);
});

test("disposal revokes every published generation, cancels calls and cleans late candidates", async () => {
  const one = { streamGate: deferred(), streamEntered: deferred(), disposeThrows: true }, two = { streamGate: deferred(), streamEntered: deferred() }, pendingBuild = deferred();
  const f = fixture({ specs: new Map([[1, one], [2, two], [4, { buildGate: pendingBuild }]]) }), proxy = await f.initialize();
  const prepared1 = await proxy.prepareCall(RA, "model"); await proxy.updateProfile({ revision: 2 });
  const prepared2 = await proxy.prepareCall(RA, "model"); await proxy.updateProfile({ revision: 3 });
  const first = collect(prepared1.stream(request())), second = collect(prepared2.stream(request()));
  await Promise.all([one.streamEntered.promise, two.streamEntered.promise]);
  const candidate = proxy.updateProfile({ revision: 4 });
  const stop = proxy.dispose();
  await Promise.all([assert.rejects(first, { code: "ACCOUNT_UNAVAILABLE" }), assert.rejects(second, { code: "ACCOUNT_UNAVAILABLE" }), assert.rejects(candidate, { code: "ACCOUNT_UNAVAILABLE" })]);
  await stop;
  for (const revision of [1, 2, 3]) assert.equal(f.delegates.get(revision).disposed, 1);
  pendingBuild.resolve(); await f.created(4); await f.revoked(4);
  assert.equal(f.delegates.get(4).disposed, 1);
  one.streamGate.resolve(); two.streamGate.resolve();
  await proxy.dispose();
  await assert.rejects(proxy.updateProfile({ revision: 5 }), { code: "ACCOUNT_UNAVAILABLE" });
  assert.throws(() => prepared1.stream(request()), { code: "ACCOUNT_UNAVAILABLE" });
});

test("pending metadata operations abort on disposal or caller cancellation", async () => {
  const gates = { prepareGate: deferred(), resolveGate: deferred(), listGate: deferred() };
  const f = fixture({ specs: new Map([[1, gates]]) }), proxy = await f.initialize(), controller = new AbortController();
  const prepared = proxy.prepareCall(RA, "model", controller.signal);
  controller.abort(new Error("cancelled metadata")); await assert.rejects(prepared, /cancelled metadata/);
  const resolved = proxy.resolveModel(RA, "model"), listed = proxy.listModels(RA);
  await proxy.dispose();
  await Promise.all([assert.rejects(resolved, { code: "ACCOUNT_UNAVAILABLE" }), assert.rejects(listed, { code: "ACCOUNT_UNAVAILABLE" })]);
  gates.prepareGate.resolve(); gates.resolveGate.resolve(); gates.listGate.resolve();
});

test("delegate identity validation and initialization failure are sanitized", async () => {
  const f = fixture({ specs: new Map([[1, { badInfo: true }]]) });
  await assert.rejects(f.initialize(), { code: "ACCOUNT_PROFILE_INVALID" });
  assert.equal(f.delegates.get(1).disposed, 1);
  await assert.rejects(createProfiledAccountAdapter(), { code: "ACCOUNT_RUNTIME_UNAVAILABLE" });
  const good = fixture(), proxy = await good.initialize(), prepared = await proxy.prepareCall(RA, "model");
  assert.throws(() => prepared.stream(request(RB)), { code: "NO_ADAPTER" });
  assert.throws(() => prepared.stream(request(RA, { model: "other" })), { code: "PREPARED_CALL_MISMATCH" });
  await proxy.dispose();
});
