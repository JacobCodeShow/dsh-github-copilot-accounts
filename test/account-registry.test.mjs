import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountRegistry } from "../src/account-registry.mjs";
import { accountRouteId } from "../src/account-route-id.mjs";

const slot = (name = "alice", domain = "company-a.ghe.com") => ({ key: `copilot-auth/account-${name}`, payload: {
  type: "oauth", refresh: "FAKE_REFRESH_NOT_REAL", access: "FAKE_ACCESS_NOT_REAL", enterpriseUrl: domain,
  account: { login: name, name: name.toUpperCase(), domain, avatarUrl: "https://example.invalid/avatar" },
} });
function fixture(extra = {}) {
  const state = { slots: [slot()], registered: new Map(), created: [], updates: [], replaceCalls: [] };
  const options = {
    llm: { registerAdapter(routes, adapter) {
      for (const id of routes) if (state.registered.has(id)) throw new Error("duplicate route");
      for (const id of routes) state.registered.set(id, adapter);
      const dispose = () => { for (const id of routes) if (state.registered.get(id) === adapter) state.registered.delete(id); };
      dispose.replace = (next) => { state.replaceCalls.push(next); };
      return dispose;
    } },
    listSlots: async () => state.slots,
    createAdapter: async (config) => {
      const adapter = { config, disposed: false, dispose() { this.disposed = true; }, providerInfo() { return { id: config.routeId, name: config.displayName() }; } };
      state.created.push(adapter);
      return adapter;
    },
    emitModelsUpdated: (id) => state.updates.push(id),
    ...extra,
  };
  return { state, options, registry: createAccountRegistry(options) };
}

test("registry creates isolated stable account routes and exposes metadata without grant fields", async () => {
  const { state, registry } = fixture();
  state.slots.push(slot("alice-2", "company-b.ghe.com"));
  const rows = await registry.reconcile();
  assert.equal(rows.length, 2);
  assert.equal(state.registered.size, 2);
  assert.equal(state.created.length, 2);
  assert.notEqual(rows[0].routeId, rows[1].routeId);
  assert.equal(registry.accountForRoute(rows[0].routeId).id, rows[0].id);
  assert.equal(state.created[0].config.accountId, rows[0].id);
  assert.equal(state.created[0].config.isEnabled(), true);
  assert.ok(!JSON.stringify(rows).includes("FAKE_"));
  rows[0].label = "caller mutation";
  assert.equal(registry.account(rows[0].id).label, "company-a.ghe.com/alice");
  await registry.reconcile();
  assert.equal(state.created.length, 2, "unchanged slots reuse adapters");
});

test("profile rename updates display without rebinding route or credentials", async () => {
  const { state, registry } = fixture();
  const [before] = await registry.reconcile();
  const adapter = state.created[0];
  state.slots[0].payload.account.login = "alice-renamed";
  state.slots[0].payload.enterpriseUrl = "company-b.ghe.com";
  const [after] = await registry.reconcile();
  assert.equal(after.id, before.id);
  assert.equal(after.routeId, before.routeId);
  assert.equal(state.created.length, 1);
  assert.equal(adapter.providerInfo().name, "GitHub Copilot — company-b.ghe.com/alice-renamed");
  assert.deepEqual(state.replaceCalls, [[after.routeId]]);
});

test("explicit removal invalidates prepared adapter before unregister and tombstones stale reads", async () => {
  const { state, registry } = fixture();
  const [row] = await registry.reconcile();
  const adapter = state.created[0];
  registry.remove(row.id);
  assert.equal(adapter.config.isEnabled(), false);
  assert.equal(adapter.disposed, true);
  assert.equal(state.registered.has(row.routeId), false);
  assert.equal(registry.account(row.id), undefined);
  assert.equal(registry.accountForRoute(row.routeId), undefined);
  assert.deepEqual(await registry.reconcile(), [], "old live-store snapshots cannot undo explicit removal");
  assert.equal(state.created.length, 1);
  const [reactivated] = await registry.reactivate(row.id);
  assert.equal(reactivated.routeId, row.routeId);
  assert.equal(state.created.length, 2);
  assert.equal(state.created[1].config.isEnabled(), true);
});

test("reconciliation removes deleted slots without changing remaining account routes", async () => {
  const { state, registry } = fixture();
  state.slots.push(slot("bob"));
  const before = await registry.reconcile();
  const removed = state.created[0];
  state.slots.shift();
  const after = await registry.reconcile();
  assert.equal(after.length, 1);
  assert.equal(after[0].routeId, before[1].routeId);
  assert.equal(removed.disposed, true);
  assert.equal(state.registered.size, 1);
});

test("rejected new registrations roll back additions and leave existing account serving", async () => {
  const { state, registry } = fixture();
  const [initial] = await registry.reconcile();
  state.slots.push(slot("bob"), slot("charlie"));
  const conflict = accountRouteId("copilot-auth/account-charlie");
  const foreign = { foreign: true };
  state.registered.set(conflict, foreign);
  await assert.rejects(registry.reconcile(), /duplicate route/);
  assert.equal(registry.accounts().length, 1);
  assert.equal(state.registered.get(initial.routeId), state.created[0]);
  assert.equal(state.created[0].config.isEnabled(), true);
  assert.equal(state.registered.has(accountRouteId("copilot-auth/account-bob")), false);
  assert.equal(state.registered.get(conflict), foreign, "do not remove somebody else's registration");
  assert.equal(state.created[1].disposed, true);
  assert.equal(state.created[2].disposed, true);
});

test("queued reconcile reads current slots at execution rather than caller submission", async () => {
  let release, started;
  const ready = new Promise((resolve) => { started = resolve; });
  const { state, registry } = fixture({ createAdapter: async (config) => {
    if (!release) await new Promise((resolve) => { release = resolve; started(); });
    return { config, dispose() {} };
  } });
  const first = registry.reconcile();
  await ready;
  const second = registry.reconcile();
  state.slots = [slot("bob")];
  release();
  await first;
  const rows = await second;
  assert.deepEqual(rows.map((row) => row.id), ["copilot-auth/account-bob"]);
  assert.equal(state.registered.size, 1);
});

test("dispose during async preparation prevents late registration and cleans created adapter", async () => {
  let release, started, disposed = false;
  const ready = new Promise((resolve) => { started = resolve; });
  const { state, registry } = fixture({ createAdapter: async () => {
    await new Promise((resolve) => { release = resolve; started(); });
    return { dispose() { disposed = true; } };
  } });
  const pending = registry.reconcile();
  await ready;
  registry.dispose();
  release();
  await assert.rejects(pending, (error) => error.code === "REGISTRY_DISPOSED");
  assert.equal(disposed, true);
  assert.equal(state.registered.size, 0);
  await assert.rejects(registry.reconcile(), (error) => error.code === "REGISTRY_DISPOSED");
});

test("removal during route publication never leaves a registered tombstoned candidate", async () => {
  const { state, options, registry } = fixture();
  const register = options.llm.registerAdapter;
  options.llm.registerAdapter = (ids, adapter) => {
    const handle = register(ids, adapter);
    registry.remove("copilot-auth/account-alice");
    return handle;
  };
  assert.deepEqual(await registry.reconcile(), []);
  assert.equal(state.registered.size, 0);
  assert.equal(state.created[0].disposed, true);
});

test("dispose withdraws all own routes, observer errors cannot corrupt topology", async () => {
  const { state, registry } = fixture({ emitModelsUpdated() { throw new Error("observer failed"); } });
  state.slots.push(slot("bob"));
  await registry.reconcile();
  registry.dispose();
  registry.dispose();
  assert.equal(state.registered.size, 0);
  assert.ok(state.created.every((adapter) => adapter.disposed && !adapter.config.isEnabled()));
  assert.deepEqual(registry.accounts(), []);
});
