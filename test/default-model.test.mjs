import { test } from "node:test";
import assert from "node:assert/strict";
import { accountRouteId, GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
import { SESSION_LLM_PUBLIC_METHODS } from "../src/session-catalog-policy.mjs";
import {
  createDefaultModelPolicy, createDefaultModelPolicyMarker, installDefaultModelPolicy, withSessionSelectionOnly,
  DEFAULT_MODEL_POLICY_SERVICE, createControllerProtectionGuard, installRestartBoundary, inject,
} from "../src/default-model.mjs";

const ALIAS = accountRouteId("copilot-auth/account-test");
const native = { provider: "github-copilot", model: "gpt-5.4", reasoningEffort: "high" };
const other = { provider: "other-provider", model: "other-model", reasoningEffort: "low" };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function backingFixture(initial = native) {
  const saved = [];
  let current = structuredClone(initial);
  return {
    saved,
    currentSelection() { return current; },
    saveSelection(next) { saved.push(next); current = { ...next }; return Promise.resolve(); },
  };
}

test("bound-alias stock picker saves do not change global account, model or effort", async () => {
  const backing = backingFixture(other);
  const policy = createDefaultModelPolicy(backing);
  await policy.saveSelection({ provider: ALIAS, model: "changed-model", reasoningEffort: "medium" });
  assert.deepEqual(backing.saved, []);
  assert.deepEqual(backing.currentSelection(), other);
  assert.ok(Object.isFrozen(policy));
});

test("native and other ordinary selections delegate unchanged to native saver", async () => {
  const backing = backingFixture();
  const policy = createDefaultModelPolicy(backing);
  await policy.saveSelection(native);
  await policy.saveSelection(other);
  assert.deepEqual(backing.saved, [native, other]);
  assert.equal(backing.saved[0], native);
  assert.equal(backing.saved[1], other);
});

test("only reserved full account aliases are suppressed", async () => {
  const backing = backingFixture();
  const policy = createDefaultModelPolicy(backing);
  for (const provider of ["github-copilot-account-a", "copilot-account-user", `copilot-account-${"A".repeat(64)}`, `copilot-account-${"a".repeat(63)}`]) {
    await policy.saveSelection({ provider, model: "test-model" });
  }
  assert.equal(backing.saved.length, 4);
});

test("startup alias fallback normalizes only the detached returned selection", () => {
  const original = Object.freeze({ provider: ALIAS, model: "gpt-5.4", reasoningEffort: "high" });
  const backing = { currentSelection: () => original, saveSelection: () => assert.fail("read must not save") };
  const read = createDefaultModelPolicy(backing).currentSelection();
  assert.deepEqual(read, native);
  assert.equal(original.provider, ALIAS);
  assert.notEqual(read, original);
  read.model = "mutated-copy";
  assert.equal(original.model, "gpt-5.4");
});

test("native/other fallback reads preserve model, effort and extra data", () => {
  for (const selection of [native, other, { provider: "other-provider", model: "bare" }]) {
    const backing = backingFixture(selection);
    const read = createDefaultModelPolicy(backing).currentSelection();
    assert.deepEqual(read, selection);
    assert.notEqual(read, backing.currentSelection());
  }
});

test("explicit session-only bind/unbind suppresses native saves across awaits", async () => {
  const backing = backingFixture(other), policy = createDefaultModelPolicy(backing);
  const result = await withSessionSelectionOnly(async () => {
    await Promise.resolve();
    await policy.saveSelection(native);
    await policy.saveSelection(other);
    return "bound";
  });
  assert.equal(result, "bound");
  assert.deepEqual(backing.saved, []);
  assert.deepEqual(backing.currentSelection(), other);
  await policy.saveSelection(native);
  assert.deepEqual(backing.saved, [native]);
});

test("session-only async scope does not suppress concurrent ordinary selections", async () => {
  const backing = backingFixture(), policy = createDefaultModelPolicy(backing);
  const entered = deferred(), release = deferred();
  const scoped = withSessionSelectionOnly(async () => {
    entered.resolve();
    await release.promise;
    await policy.saveSelection(native);
  });
  await entered.promise;
  await policy.saveSelection(other);
  release.resolve();
  await scoped;
  assert.deepEqual(backing.saved, [other]);
});

test("scope supports sync values, nested calls and errors without leaking", async () => {
  const backing = backingFixture(), policy = createDefaultModelPolicy(backing);
  assert.equal(withSessionSelectionOnly(() => 42), 42);
  await withSessionSelectionOnly(() => withSessionSelectionOnly(() => policy.saveSelection(native)));
  assert.throws(() => withSessionSelectionOnly(() => { throw new Error("mock sync failure"); }), /mock sync failure/);
  await assert.rejects(withSessionSelectionOnly(async () => { throw new Error("mock async failure"); }), /mock async failure/);
  await policy.saveSelection(other);
  assert.deepEqual(backing.saved, [other]);
  assert.throws(() => withSessionSelectionOnly(null), /operation required/);
});

test("ordinary saver promises/errors are passed through, not reimplemented", async () => {
  const pending = deferred();
  const failure = new Error("native saver failure");
  let calls = 0;
  const policy = createDefaultModelPolicy({
    currentSelection: () => native,
    saveSelection() { calls++; return calls === 1 ? pending.promise : Promise.reject(failure); },
  });
  const actual = policy.saveSelection(other);
  assert.equal(actual, pending.promise);
  pending.resolve("native result");
  assert.equal(await actual, "native result");
  await assert.rejects(policy.saveSelection(native), (error) => error === failure);
});

test("managed readiness changes scoped fallback without changing saved identity", () => {
  const backing=backingFixture(native);let ready=false;
  const policy=createDefaultModelPolicy(backing,{isManagedReady:()=>ready});
  assert.deepEqual(policy.currentSelection(),native);
  ready=true;assert.deepEqual(policy.currentSelection(),{...native,provider:GLOBAL_COPILOT_ROUTE});
  assert.deepEqual(backing.currentSelection(),native);assert.deepEqual(backing.saved,[]);
  ready=false;assert.deepEqual(policy.currentSelection(),native);
});

test("ordinary managed-global model save normalizes to native while explicit scope still suppresses", async () => {
  const backing=backingFixture(other),policy=createDefaultModelPolicy(backing,{isManagedReady:()=>true});
  const selected=Object.freeze({...native,provider:GLOBAL_COPILOT_ROUTE});
  await policy.saveSelection(selected);
  assert.deepEqual(backing.saved,[native]);assert.equal(selected.provider,GLOBAL_COPILOT_ROUTE);
  await withSessionSelectionOnly(()=>policy.saveSelection({...selected,model:"session-only"}));
  assert.equal(backing.saved.length,1);
});

test("stored managed or bound alias fallback is never an unsupported route", () => {
  for(const provider of [ALIAS,GLOBAL_COPILOT_ROUTE]){
    const backing=backingFixture({...native,provider});
    assert.equal(createDefaultModelPolicy(backing).currentSelection().provider,"github-copilot");
    assert.equal(createDefaultModelPolicy(backing,{isManagedReady:()=>true}).currentSelection().provider,GLOBAL_COPILOT_ROUTE);
    assert.equal(backing.currentSelection().provider,provider);
  }
});

test("invalid backing is rejected instead of silently inventing global defaults", () => {
  for (const invalid of [undefined, {}, { currentSelection() {} }, { saveSelection() {} }]) {
    assert.throws(() => createDefaultModelPolicy(invalid), /backing service required/);
  }
});

test("disposed marker cannot invoke a retained bind/unbind callback", async () => {
  const { marker, deactivate } = createDefaultModelPolicyMarker(() => true);
  const backing = backingFixture(other), policy = createDefaultModelPolicy(backing);
  assert.equal(marker.version, 1);
  assert.equal(marker.active, true);
  await marker.withSessionSelectionOnly(() => policy.saveSelection(native));
  assert.deepEqual(backing.saved, []);
  deactivate();
  assert.equal(marker.version, undefined);
  assert.equal(marker.active, false);
  let invoked = false;
  assert.throws(() => marker.withSessionSelectionOnly(() => { invoked = true; }), /policy is unavailable/);
  assert.equal(invoked, false);
  deactivate(); // idempotent cleanup
});

function mountFixture() {
  const Context = { isolate: Symbol("Context.isolate") };
  const publicLabel = Symbol("public-default"), policyLabel = Symbol("private-default-policy"), publicLlm = Symbol("public-llm"), privateLlm = Symbol("private-llm");
  const parentMap = { agentDefaultModel: publicLabel, llm: publicLlm };
  const map = Object.assign(Object.create(parentMap), { agentDefaultModel: policyLabel, llm: privateLlm });
  const provisions = [], cleanups = [], listeners = [];
  const tree = {};
  const controller = { parent: { tree }, options: { id: "session-controller", name: "@deepseek-ai/dsh-api-session-controller", isolate: { agentDefaultModel: "copilot-session-default-model", llm: "copilot-session-llm" } }, ctx: { [Context.isolate]: { agentDefaultModel: policyLabel, llm: privateLlm } } };
  tree.resolve = (id) => { assert.equal(id, "session-controller"); return controller; };
  const root = { on(event, listener, options) { listeners.push({ event, listener, options }); } };
  let activate;
  const injected = { pending: true };
  const llm = Object.fromEntries(SESSION_LLM_PUBLIC_METHODS.map((method) => [method, () => undefined]));
  llm.listProviders = () => []; llm.listModels = async () => [];
  const bound = {
    llm, get() { return undefined; },
    effect(operation) { cleanups.push(operation()); },
    provide(name, value) { provisions.push({ name, label: parentMap[name], value }); },
    isolate(name, label) { return { provide(providedName, value) { provisions.push({ name: providedName, label, value }); } }; },
  };
  const ctx = {
    [Context.isolate]: map,
    root,
    fiber: { entry: { options: { isolate: { agentDefaultModel: "copilot-session-default-model", llm: "copilot-session-llm" } }, parent: { tree, ctx: { [Context.isolate]: parentMap } } } },
    get agentDefaultModel() { assert.fail("must not inject its own private service"); },
    extend(meta) {
      assert.equal(meta[Context.isolate], parentMap);
      return { inject(keys, callback) {
        assert.deepEqual(keys, ["agentDefaultModel", "llm"]);
        activate = (backing) => { bound.agentDefaultModel = backing; callback(bound); };
        return injected;
      } };
    },
  };
  return { Context, ctx, publicLabel, policyLabel, provisions, injected, cleanups, listeners, tree, controller, publicLlm, privateLlm, activate: (backing) => activate(backing) };
}

test("mount waits on public backing then provides separate private facade and marker", async () => {
  const fixture = mountFixture();
  assert.deepEqual(inject, [], "private policy must not declare a self dependency");
  assert.equal(installDefaultModelPolicy(fixture.ctx, fixture.Context), fixture.injected);
  assert.deepEqual(fixture.provisions, []);
  const backing = backingFixture(other);
  fixture.activate(backing);
  const facade = fixture.provisions.find((row) => row.name === "agentDefaultModel");
  const marker = fixture.provisions.find((row) => row.name === DEFAULT_MODEL_POLICY_SERVICE);
  assert.equal(fixture.provisions.find((row) => row.name === "llm").label, fixture.privateLlm);
  assert.equal(facade.name, "agentDefaultModel");
  assert.equal(facade.label, fixture.policyLabel);
  assert.notEqual(facade.label, fixture.publicLabel);
  assert.equal(marker.name, DEFAULT_MODEL_POLICY_SERVICE);
  assert.equal(marker.value.version, 1);
  await marker.value.withSessionSelectionOnly(() => facade.value.saveSelection(native));
  assert.deepEqual(backing.saved, []);
  assert.deepEqual(backing.currentSelection(), other);
  for (const cleanup of fixture.cleanups) cleanup();
  assert.equal(marker.value.active, false);
  assert.throws(() => marker.value.withSessionSelectionOnly(() => assert.fail("stale marker invoked")), /policy is unavailable/);
});

test("controller protection rejects missing guards, name mismatch, partial removal and other trees", () => {
  const missing = createDefaultModelPolicyMarker().marker;
  assert.equal(missing.active, true);
  assert.equal(missing.isControllerProtected(), false);
  assert.throws(() => missing.withSessionSelectionOnly(() => assert.fail("unguarded")), /policy is unavailable/);
  const fixture = mountFixture();
  const guard = createControllerProtectionGuard(fixture.ctx, fixture.Context);
  assert.equal(guard(), true);
  fixture.controller.options.name = "unsupported-controller";
  assert.equal(guard(), false);
  fixture.controller.options.name = "@deepseek-ai/dsh-api-session-controller";
  fixture.controller.options.isolate = undefined;
  assert.equal(guard(), false);
  fixture.controller.options.isolate = { agentDefaultModel: "copilot-session-default-model", llm: "copilot-session-llm" };
  delete fixture.controller.options.isolate.llm; assert.equal(guard(), false);
  fixture.controller.options.isolate.llm = "copilot-session-llm";
  fixture.controller.ctx[fixture.Context.isolate].llm = fixture.publicLlm; assert.equal(guard(), false);
  fixture.controller.ctx[fixture.Context.isolate].llm = fixture.privateLlm; assert.equal(guard(), true);
  fixture.controller.ctx[fixture.Context.isolate].agentDefaultModel = fixture.publicLabel;
  assert.equal(guard(), false);
  fixture.controller.ctx[fixture.Context.isolate].agentDefaultModel = fixture.policyLabel;
  fixture.controller.parent.tree = {};
  assert.equal(guard(), false);
  fixture.tree.resolve = () => { throw new Error("different nested tree"); };
  assert.equal(guard(), false);
});

test("root restart guard dedupes and blocks scope fallback even after policy cleanup", () => {
  const fixture = mountFixture();
  installRestartBoundary(fixture.ctx, fixture.Context);
  installRestartBoundary(fixture.ctx, fixture.Context);
  assert.equal(fixture.listeners.length, 1);
  const [{ event, listener, options }] = fixture.listeners;
  assert.equal(event, "loader/patch-context");
  assert.deepEqual(options, { prepend: true, global: true });
  const target = { parent: { tree: fixture.tree }, options: { id: "session-controller" }, ctx: { [fixture.Context.isolate]: { agentDefaultModel: fixture.policyLabel, llm: fixture.privateLlm } } };
  let nextCalled = false;
  const next = () => { nextCalled = true; return "allowed"; };
  assert.throws(() => listener(target, next), (error) => error.code === "COPILOT_RESTART_REQUIRED" && /full DSH restart/.test(error.message));
  assert.equal(nextCalled, false);
  target.options.isolate = { agentDefaultModel: "copilot-session-default-model", llm: "copilot-session-llm" };
  assert.equal(listener(target, next), "allowed");
  target.options.id = "unrelated-entry";
  delete target.options.isolate;
  assert.equal(listener(target, next), "allowed");
  target.options.id = "session-controller";
  target.parent.tree = {};
  assert.equal(listener(target, next), "allowed");
});

test("mount rejects missing/seemingly public realm instead of overwriting native service", () => {
  const fixture = mountFixture();
  assert.throws(() => installDefaultModelPolicy({}, fixture.Context), /separate named consumer realm/);
  fixture.ctx[fixture.Context.isolate].agentDefaultModel = fixture.publicLabel;
  assert.throws(() => installDefaultModelPolicy(fixture.ctx, fixture.Context), /separate named consumer realm/);
  assert.deepEqual(fixture.provisions, []);
});
