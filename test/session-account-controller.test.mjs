import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionAccountController } from "../src/session-account-controller.mjs";
import { accountRouteId, GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
import { createDefaultModelPolicy, withSessionSelectionOnly } from "../src/default-model.mjs";

const native = { provider: "github-copilot", model: "gpt-5.4", reasoningEffort: "high" };
const idA = "copilot-auth/account-alice", idB = "copilot-auth/account-bob";
function fixture() {
  const accounts = new Map([idA, idB].map((id) => [id, { id, routeId: accountRouteId(id), label: id, domain: "example.ghe.com" }]));
  const makeAgent = (id) => {
    let selected = { ...native };
    const events = [];
    return { status: "idle", session: { id, requestHeader: () => ({ config: native }) }, events,
      model: { current: () => ({ ...selected }), select: (next) => { selected = { ...next }; events.push({ type: "model/selection", data: { ...next } }); } } };
  };
  const agents = new Map(["s-a", "s-b"].map((id) => [id, makeAgent(id)]));
  const state = { allowed: true, globalDefault: { provider: "other-provider", model: "other-model" }, globalSaves: [], selects: [], reads: [], admission: null, modelCheck: null };
  const defaults = createDefaultModelPolicy({ currentSelection: () => state.globalDefault,
    saveSelection: async (next) => { state.globalSaves.push({ ...next }); state.globalDefault = { ...next }; } });
  const policy = { version: 1, active: true, isControllerProtected: () => true, withSessionSelectionOnly };
  const options = {
    sessionController: {
      async resolveAgent(id) { state.reads.push(id); return agents.has(id) ? { agent: agents.get(id) } : { error: { code: "session/writer-held" } }; },
      async selectModel({ sessionId, ...selected }) {
        state.selects.push({ sessionId, ...selected });
        if (state.admission) await state.admission({ sessionId, ...selected });
        agents.get(sessionId).model.select(selected);
        await defaults.saveSelection(selected);
        return { selected };
      },
    },
    llm: { listModels: async () => [{ id: native.model }], resolveCallConfig: async (selection) => { if (state.modelCheck) await state.modelCheck(selection); return selection; } },
    registry: { account: (id) => accounts.get(id), accountForRoute: (route) => [...accounts.values()].find((a) => a.routeId === route) },
    policy,
    authorizeSession: async () => state.allowed,
  };
  return { state, agents, accounts, options, policy, defaults, controller: createSessionAccountController(options) };
}
const code = (expected) => (error) => error.code === expected;

test("A/B session bindings use independent durable routes without changing any future default", async () => {
  const { controller, agents, accounts, state } = fixture();
  await Promise.all([controller.bind({ sessionId: "s-a", accountId: idA }), controller.bind({ sessionId: "s-b", accountId: idB })]);
  assert.equal(agents.get("s-a").model.current().provider, accounts.get(idA).routeId);
  assert.equal(agents.get("s-b").model.current().provider, accounts.get(idB).routeId);
  assert.equal(agents.get("s-a").events[0].type, "model/selection");
  assert.deepEqual(agents.get("s-a").events[0].data, { ...native, provider: accounts.get(idA).routeId });
  assert.deepEqual(state.globalSaves, []);
  assert.deepEqual(state.globalDefault, { provider: "other-provider", model: "other-model" });
  const a = await controller.read({ sessionId: "s-a" });
  assert.equal(a.next.mode, "bound");
  assert.equal(a.next.accountId, idA);
  assert.equal(a.lastUsed.mode, "global", "selected next route is distinct from previous request route");
});

test("follow-global selection is session-local too, including the stock native save path", async () => {
  const { controller, agents, state } = fixture();
  await controller.bind({ sessionId: "s-a", accountId: idA });
  const result = await controller.bind({ sessionId: "s-a", accountId: null });
  assert.equal(result.next.mode, "global");
  assert.equal(result.next.accountId, null);
  assert.deepEqual(agents.get("s-a").model.current(), { ...native, provider: GLOBAL_COPILOT_ROUTE });
  assert.deepEqual(state.globalSaves, []);
  assert.deepEqual(state.globalDefault, { provider: "other-provider", model: "other-model" });
});

test("default policy also suppresses later stock model picks on a bound account", async () => {
  const { controller, options, accounts, state } = fixture();
  await controller.bind({ sessionId: "s-a", accountId: idA });
  await options.sessionController.selectModel({ sessionId: "s-a", provider: accounts.get(idA).routeId, model: "another-model" });
  assert.deepEqual(state.globalSaves, []);
  await options.sessionController.selectModel({ sessionId: "s-b", provider: "other-provider", model: "new-preference" });
  assert.deepEqual(state.globalSaves, [{ provider: "other-provider", model: "new-preference" }], "unrelated stock behavior is unchanged");
});

test("unknown/missing account or unsupported model is rejected without fallback or events", async () => {
  const { controller, agents, options, state } = fixture();
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: "copilot-auth/account-missing" }), code("ACCOUNT_UNAVAILABLE"));
  options.llm.listModels = async () => [];
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA }), code("ACCOUNT_MODEL_UNAVAILABLE"));
  options.llm.listModels = async () => { throw new Error("must not expose this diagnostic"); };
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA }), (error) => error.code === "ACCOUNT_MODEL_UNAVAILABLE" && !error.message.includes("diagnostic"));
  assert.deepEqual(agents.get("s-a").model.current(), native);
  assert.deepEqual(agents.get("s-a").events, []);
  assert.deepEqual(state.globalSaves, []);
});

test("missing bound route remains bound/unavailable in state, never global", async () => {
  const { controller, agents, accounts } = fixture();
  agents.get("s-a").model.select({ ...native, provider: accounts.get(idA).routeId });
  accounts.delete(idA);
  const state = await controller.read({ sessionId: "s-a" });
  assert.equal(state.next.mode, "bound");
  assert.equal(state.next.available, false);
  assert.equal(state.next.accountId, null);
  assert.ok(state.next.provider.startsWith("copilot-account-"));
});

test("busy, readonly/writer-held and foreign-provider sessions are not rebound", async () => {
  const { controller, agents, state } = fixture();
  agents.get("s-a").status = "running";
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA }), code("SESSION_BUSY"));
  await assert.rejects(controller.bind({ sessionId: "missing", accountId: idA }), code("session/writer-held"));
  agents.get("s-a").status = "idle";
  agents.get("s-a").model.select({ provider: "other-provider", model: "different" });
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA }), code("NOT_COPILOT_SESSION"));
  assert.deepEqual(state.selects, []);
});

test("explicit session authorization is mandatory and runs before data lookup", async () => {
  const { controller, options, state } = fixture();
  assert.throws(() => createSessionAccountController({ ...options, authorizeSession: undefined }), /explicit authorization/);
  state.allowed = false;
  await assert.rejects(controller.read({ sessionId: "s-a" }), code("SESSION_FORBIDDEN"));
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA }), code("SESSION_FORBIDDEN"));
  assert.deepEqual(state.reads, []);
  assert.deepEqual(state.selects, []);
});

test("binding requires a live tested policy marker and validates wire arguments", async () => {
  const { controller, policy } = fixture();
  for (const request of [{}, { sessionId: "" }, { sessionId: "s-a" }, { sessionId: "s-a", accountId: 42 }, { sessionId: "s-a", accountId: idA, expected: {} }]) {
    await assert.rejects(controller.bind(request), code("INVALID_ARGUMENT"));
  }
  await assert.rejects(controller.read(), code("INVALID_ARGUMENT"));
  policy.isControllerProtected = () => false;
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA }), code("POLICY_UNAVAILABLE"));
  policy.isControllerProtected = () => true;
  policy.active = false;
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA }), code("POLICY_UNAVAILABLE"));
});

test("stale UI selection and concurrent external model changes refuse overwrite", async () => {
  const { controller, agents, state } = fixture();
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA, expected: { ...native, model: "old" } }), code("STALE_SELECTION"));
  state.modelCheck = async () => { agents.get("s-a").model.select({ ...native, model: "user-changed" }); };
  await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA, expected: native }), code("STALE_SELECTION"));
  assert.deepEqual(state.selects, []);
  assert.equal(agents.get("s-a").model.current().model, "user-changed");
});

test("policy removal, revoked permissions and account deletion during validation fail closed", async () => {
  for (const reason of ["policy", "permission", "account", "busy"]) {
    const { controller, policy, accounts, agents, state } = fixture();
    state.modelCheck = async () => {
      if (reason === "policy") policy.active = false;
      if (reason === "permission") state.allowed = false;
      if (reason === "account") accounts.delete(idA);
      if (reason === "busy") agents.get("s-a").status = "running";
    };
    await assert.rejects(controller.bind({ sessionId: "s-a", accountId: idA }), code({ policy: "POLICY_UNAVAILABLE", permission: "SESSION_FORBIDDEN", account: "ACCOUNT_UNAVAILABLE", busy: "SESSION_BUSY" }[reason]));
    assert.deepEqual(state.selects, []);
    assert.deepEqual(state.globalSaves, []);
  }
});

test("per-session binding queue prevents double-click overwrites while other sessions progress", async () => {
  const { controller, state, accounts } = fixture();
  let release, notify;
  const started = new Promise((resolve) => { notify = resolve; });
  state.admission = async ({ sessionId }) => { if (sessionId === "s-a" && !release) await new Promise((resolve) => { release = resolve; notify(); }); };
  const first = controller.bind({ sessionId: "s-a", accountId: idA, expected: native });
  await started;
  const duplicate = controller.bind({ sessionId: "s-a", accountId: idB, expected: native });
  const b = await controller.bind({ sessionId: "s-b", accountId: idB });
  assert.equal(b.next.accountId, idB);
  release();
  assert.equal((await first).next.accountId, idA);
  await assert.rejects(duplicate, code("STALE_SELECTION"));
  assert.deepEqual(state.selects.map((s) => s.provider).sort(), [accounts.get(idA).routeId, accounts.get(idB).routeId].sort());
});
