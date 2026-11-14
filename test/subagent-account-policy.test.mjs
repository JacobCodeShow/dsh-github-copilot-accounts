import { test } from "node:test";
import assert from "node:assert/strict";
import { createSubagentAccountPolicy, SubagentAccountPolicyError } from "../src/subagent-account-policy.mjs";
import { accountRouteId, isAccountRoute } from "../src/account-route-id.mjs";

const PA = accountRouteId("copilot-auth/account-a"), PB = accountRouteId("copilot-auth/account-b"), PC = accountRouteId("copilot-auth/account-c");
const ORIGINAL = Symbol.for("cordis.original"), copy = (value) => structuredClone(value);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
  const agents = new Map(), sessions = new Map(), owners = new Map(), ownedRoutes = new Set([PB]);
  const selections = [], validations = [], ownership = [], queries = [];
  let releases = 0;
  const release = deferred();
  const parent = { id: "parent" };
  const creation = Object.freeze({ id: "child", version: 4, createdAt: 123, parentSession: parent.id, origin: "subagent", isSeeded: true, ...options.header });
  const session = { id: creation.id, header: creation, inheritedEventCount: options.inheritedEventCount ?? 2,
    firstLifecycleSeq: options.firstLifecycleSeq ?? 2, seq: 4 };
  const descriptor = { version: 3, mode: "continuable", provider: "fork", label: "synthetic", agentProvider: PB, agentModel: "model", agentReasoningEffort: "high", ...options.descriptor };
  const events = options.events ?? [
    { seq: 0, type: "subagent/descriptor", data: { ...descriptor, agentProvider: PA } },
    { seq: 1, type: "request/header", data: { header: { config: { provider: PA, model: "model" } }, reason: "initial" } },
    { seq: 2, type: "session/end-seed", data: { inherited: true } },
    { seq: 3, type: "subagent/descriptor", data: descriptor },
  ];
  let pending = { provider: PA, model: "model", reasoningEffort: "high" };
  const actorOverrides = {};
  const behavior = { ...options.behavior };
  const services = {
    agents: { get: (id) => agents.get(id), isOwnedBy: (id, owner) => owners.get(id) === owner },
    sessions: { get: (id) => sessions.get(id) },
    llm: { async resolveCallConfig(selection) {
      assert.equal(Object.isFrozen(selection), true); validations.push(copy(selection));
      behavior.validationEntered?.resolve(); if (behavior.validationGate) await behavior.validationGate.promise;
      if (behavior.validationError) throw behavior.validationError;
      return { ...selection, ...behavior.resolved };
    } },
    sessionQuery: { async observeSession(id, readOptions) {
      queries.push({ id, options: readOptions }); behavior.queryEntered?.resolve();
      if (behavior.queryGate) await behavior.queryGate.promise;
      if (behavior.queryError) throw behavior.queryError;
      return { source: "live", header: creation, inheritedEventCount: session.inheritedEventCount,
        events: copy(events), ...behavior.observation,
        [Symbol.dispose]() { releases++; release.resolve(); if (behavior.releaseError) throw behavior.releaseError; } };
    } },
  };
  const context = { get: (name) => services[name] };
  const agent = { id: session.id, session, options: { provider: PB, model: "model", reasoningEffort: "high", ...options.agentOptions },
    ctx: { get: (name) => Object.hasOwn(actorOverrides, name) ? actorOverrides[name] : services[name] },
    model: { current: () => copy(pending), select(selection) {
      if (JSON.stringify(pending) === JSON.stringify(selection)) return;
      pending = copy(selection); selections.push(copy(selection));
      events.push({ seq: session.seq++, type: "model/selection", data: copy(selection) });
    } },
  };
  agents.set(parent.id, parent); agents.set(agent.id, agent); sessions.set(session.id, session); owners.set(agent.id, parent);
  const ownsRoute = async (provider) => { ownership.push(provider); if (behavior.ownershipError) throw behavior.ownershipError; return ownedRoutes.has(provider); };
  const handler = createSubagentAccountPolicy({ context, isAccountRoute, ownsRoute, originalSymbol: ORIGINAL, ...options.policy });
  const invoke = (extra = {}) => handler({ agent, source: "startup", ...extra });
  return { context, services, agent, parent, session, events, descriptor, handler, invoke, behavior, agents, sessions, owners, actorOverrides, ownedRoutes,
    selections, validations, ownership, queries, releases: () => releases, released: release.promise };
}

test("new native fork appends captured bound selection after prefix, preserving header/history", async () => {
  const f = fixture(), headerBefore = copy(f.session.header), prefix = copy(f.events.slice(0, 2));
  assert.equal(await f.invoke(), true);
  assert.deepEqual(f.selections, [{ provider: PB, model: "model", reasoningEffort: "high" }]);
  assert.deepEqual(f.events.slice(0, 2), prefix); assert.deepEqual(f.session.header, headerBefore);
  assert.equal(f.events.at(-1).type, "model/selection"); assert.equal(f.events.at(-1).seq, 4);
  assert.deepEqual(f.validations, f.selections); assert.deepEqual(f.ownership, [PB, PB]);
  assert.equal(f.queries[0].options.projectionMode, "none"); assert.equal(f.releases(), 1);
  assert.equal(await f.invoke(), false, "native select deduplicates already-recorded choice");
  assert.equal(f.selections.length, 1);
});

test("Cordis original service identity permits tracing proxies but excludes other isolated scopes", async () => {
  const same = fixture();
  for (const name of ["agents", "sessions", "llm", "sessionQuery"]) same.actorOverrides[name] = { [ORIGINAL]: same.services[name] };
  assert.equal(await same.invoke(), true);
  for (const name of ["agents", "sessions", "llm", "sessionQuery"]) {
    const other = fixture(); other.actorOverrides[name] = { ...other.services[name] };
    assert.equal(await other.invoke(), false, name); assert.equal(other.queries.length, 0); assert.equal(other.selections.length, 0);
  }
});

test("resume, ordinary UI forks, unbound routes and non-native actors remain untouched", async () => {
  const resumed = fixture(); assert.equal(await resumed.invoke({ source: "resume" }), false);
  const ui = fixture({ header: { origin: undefined } }); assert.equal(await ui.invoke(), false);
  const fresh = fixture({ header: { isSeeded: false } }); assert.equal(await fresh.invoke(), false);
  const legacy = fixture({ agentOptions: { provider: "github-copilot" } }); assert.equal(await legacy.invoke(), false);
  const external = fixture(); delete external.agent.model.select; assert.equal(await external.invoke(), false);
  const root = fixture(); root.owners.delete(root.agent.id); assert.equal(await root.invoke(), false, "top-level prefix fork is not a native child");
  for (const f of [resumed, ui, fresh, legacy, external, root]) assert.equal(f.selections.length, 0);
});

test("historical descriptor never rebinds resumed/startup roots, and first own descriptor is authoritative", async () => {
  const history = fixture({ firstLifecycleSeq: 4 });
  assert.equal(await history.invoke(), false); assert.equal(history.ownership.length, 0);
  const noDescriptor = fixture({ events: [{ seq: 0, type: "subagent/descriptor", data: { provider: "fork" } }] });
  assert.equal(await noDescriptor.invoke(), false);
  const otherBackend = fixture({ descriptor: { provider: "external-acp" } });
  assert.equal(await otherBackend.invoke(), false);
  const firstOld = fixture({ firstLifecycleSeq: 4 });
  firstOld.events.push({ seq: 5, type: "subagent/descriptor", data: copy(firstOld.descriptor) });
  assert.equal(await firstOld.invoke(), false, "later duplicate cannot rewrite first historical own descriptor");
});

test("explicit child-owned model selection or request header is never overridden", async () => {
  const selected = fixture();
  selected.agent.model.select({ provider: PC, model: "model", reasoningEffort: "high" });
  const before = copy(selected.events);
  assert.equal(await selected.invoke(), false);
  assert.deepEqual(selected.events, before);
  assert.equal(selected.agent.model.current().provider, PC);
  assert.equal(selected.selections.length, 1);
  assert.equal(selected.validations.length, 0); assert.equal(selected.ownership.length, 0);
  const requested = fixture();
  requested.events.push({ seq: requested.session.seq++, type: "request/header", data: { header: { config: { provider: PC, model: "model" } }, reason: "initial" } });
  const headerBefore = copy(requested.events);
  assert.equal(await requested.invoke(), false);
  assert.deepEqual(requested.events, headerBefore); assert.equal(requested.selections.length, 0);
});

test("fork provider name is configurable without broadening to other backend descriptors", async () => {
  const f = fixture({ descriptor: { provider: "custom-native-fork" }, policy: { forkProviderName: "custom-native-fork" } });
  assert.equal(await f.invoke(), true);
});

test("descriptor must exactly agree with captured route/model/effort and released version", async () => {
  for (const descriptor of [{ agentProvider: PA }, { agentModel: "other" }, { agentReasoningEffort: undefined }, { version: 2 }, { mode: "one-shot" }]) {
    const f = fixture({ descriptor });
    await assert.rejects(f.invoke(), { code: "ACCOUNT_CHILD_BINDING_INVALID" });
    assert.equal(f.selections.length, 0); assert.equal(f.validations.length, 0); assert.equal(f.releases(), 1);
  }
  const invalidBoundary = fixture({ firstLifecycleSeq: 1 });
  await assert.rejects(invalidBoundary.invoke(), { code: "ACCOUNT_CHILD_BINDING_INVALID" });
});

test("missing captured route fails closed before lookup, never falling back to prefix account", async () => {
  const f = fixture(); f.ownedRoutes.delete(PB);
  await assert.rejects(f.invoke(), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal(f.agent.model.current().provider, PA); assert.equal(f.selections.length, 0);
  assert.equal(f.validations.length, 0); assert.equal(f.releases(), 1);
});

test("route removal during validation and redirected metadata both reject before model.select", async () => {
  const gate = deferred(), entered = deferred(), f = fixture({ behavior: { validationGate: gate, validationEntered: entered } });
  const pending = f.invoke(); await entered.promise; f.ownedRoutes.delete(PB); gate.resolve();
  await assert.rejects(pending, { code: "ACCOUNT_UNAVAILABLE" }); assert.equal(f.selections.length, 0);
  const redirected = fixture({ behavior: { resolved: { provider: PC } } });
  await assert.rejects(redirected.invoke(), { code: "ACCOUNT_CHILD_BINDING_INVALID" });
  assert.equal(redirected.selections.length, 0);
});

test("live parent/child/session/scope identities are rechecked after asynchronous work", async () => {
  for (const change of ["parent", "child", "session", "scope"]) {
    const gate = deferred(), entered = deferred(), f = fixture({ behavior: { validationGate: gate, validationEntered: entered } });
    const pending = f.invoke(); await entered.promise;
    if (change === "parent") f.agents.delete(f.parent.id);
    if (change === "child") f.agents.delete(f.agent.id);
    if (change === "session") f.sessions.delete(f.session.id);
    if (change === "scope") f.services.llm = { ...f.services.llm };
    gate.resolve(); await assert.rejects(pending, { code: "ACCOUNT_UNAVAILABLE" });
    assert.equal(f.selections.length, 0); assert.equal(f.releases(), 1);
  }
});

test("captured options do not change while route validation awaits", async () => {
  const gate = deferred(), entered = deferred(), f = fixture({ behavior: { validationGate: gate, validationEntered: entered } });
  const pending = f.invoke(); await entered.promise; f.agent.options.provider = PC; gate.resolve();
  assert.equal(await pending, true); assert.equal(f.selections[0].provider, PB);
});

test("cancelled initialization settles promptly and releases adopted or late query observations", async () => {
  const gate = deferred(), entered = deferred(), f = fixture({ behavior: { queryGate: gate, queryEntered: entered } }), controller = new AbortController();
  const pending = f.invoke({ signal: controller.signal }); await entered.promise;
  controller.abort(new Error("cancelled native child")); await assert.rejects(pending, /cancelled native child/);
  assert.equal(f.selections.length, 0); gate.resolve(); await f.released;
  assert.equal(f.releases(), 1, "late lease released after cancellation wins adoption");
  const metadataGate = deferred(), metadataEntered = deferred(), second = fixture({ behavior: { validationGate: metadataGate, validationEntered: metadataEntered } }), stop = new AbortController();
  const other = second.invoke({ signal: stop.signal }); await metadataEntered.promise;
  stop.abort(new Error("cancelled metadata")); await assert.rejects(other, /cancelled metadata/);
  metadataGate.resolve(); assert.equal(second.releases(), 1); assert.equal(second.selections.length, 0);
});

test("lookup/query errors including same-code external errors never expose private diagnostics", async () => {
  for (const behavior of [{ queryError: new Error("FAKE_PRIVATE_URL") }, { validationError: new SubagentAccountPolicyError("FAKE_PRIVATE_URL", "ACCOUNT_UNAVAILABLE") }, { ownershipError: new Error("FAKE_PRIVATE_URL") }]) {
    const f = fixture({ behavior });
    await assert.rejects(f.invoke(), (error) => error.code === "ACCOUNT_UNAVAILABLE" && !error.message.includes("PRIVATE") && error.cause === undefined);
    assert.equal(f.selections.length, 0);
  }
});

test("only a matching live observation can provide new-child evidence", async () => {
  for (const observation of [{ source: "persisted" }, { header: { id: "wrong", createdAt: 123 } }, { inheritedEventCount: 0 }, { events: null }]) {
    const f = fixture({ behavior: { observation } });
    await assert.rejects(f.invoke(), { code: "ACCOUNT_CHILD_BINDING_INVALID" });
    assert.equal(f.selections.length, 0); assert.equal(f.releases(), 1);
  }
  assert.throws(() => createSubagentAccountPolicy(), { code: "ACCOUNT_RUNTIME_UNAVAILABLE" });
});
