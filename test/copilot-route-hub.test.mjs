import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createCopilotRouteHub } from "../src/copilot-route-hub.mjs";
import { accountRouteId, GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
const a = accountRouteId("copilot-auth/account-a"), b = accountRouteId("copilot-auth/account-b");
const delegate = (route, marker) => ({
  providerInfo: (id) => ({ id, name: marker }), providerRetryPolicy: () => undefined,
  imageRequestPricing: () => undefined, imageRequestTarget: (_p, _m, image) => image,
  listModels: async () => [{ provider: route, id: "model", name: marker }],
  resolveModel: async () => ({ provider: route, id: "model", name: marker }),
  prepareCall: async () => ({ model: { provider: route, id: "model", name: marker }, stream: () => (async function* () { yield marker; })() }),
  stream: () => (async function* () { yield marker; })(),
});
function fixture() {
  const state = { registrations: 0, routes: [], adapter: null, replacements: 0 };
  const llm = { registerAdapter(routes, adapter) {
    state.registrations++; state.routes = routes; state.adapter = adapter;
    const handle = () => { state.routes = []; };
    handle.replace = (next) => { state.routes = next; state.replacements++; };
    return handle;
  } };
  return { state, hub: createCopilotRouteHub({ llm, LlmAdapter: class {} }) };
}

test("all logical account/default routes use one public owning adapter with independent delegates", async () => {
  const { hub, state } = fixture();
  const da = delegate(a, "A"), db = delegate(b, "B"), dg = delegate(GLOBAL_COPILOT_ROUTE, "global");
  hub.registerAdapter([GLOBAL_COPILOT_ROUTE], dg);
  hub.registerAdapter([a], da); hub.registerAdapter([b], db);
  assert.equal(state.registrations, 1);
  assert.equal(state.adapter, hub.adapter);
  assert.deepEqual(new Set(state.routes), new Set([GLOBAL_COPILOT_ROUTE, a, b]));
  assert.equal(hub.get(a), da); assert.equal(hub.get(b), db);
  assert.equal((await hub.adapter.resolveModel(a, "model")).name, "A");
  assert.equal((await hub.adapter.resolveModel(b, "model")).name, "B");
});

test("hub capture happens before await and old prepared calls retain their delegate", async () => {
  const { hub } = fixture();
  const da = delegate(a, "A"), handle = hub.registerAdapter([a], da);
  const prepared = await hub.adapter.prepareCall(a, "model");
  handle();
  hub.registerAdapter([a], delegate(a, "replacement"));
  const values = []; for await (const chunk of prepared.stream({ provider: a, model: "model" })) values.push(chunk);
  assert.deepEqual(values, ["A"]);
  assert.equal((await hub.adapter.resolveModel(a, "model")).name, "replacement");
});

test("duplicate/foreign names and failed metadata replacement leave committed map intact", async () => {
  const { hub, state } = fixture();
  const da = delegate(a, "A"), handle = hub.registerAdapter([a], da);
  assert.throws(() => hub.registerAdapter([a], delegate(a, "other")), { code: "DUPLICATE_ADAPTER" });
  assert.throws(() => hub.registerAdapter(["github-copilot"], delegate("github-copilot", "native")), { code: "INVALID_ADAPTER" });
  assert.throws(() => handle.replace([a, a]), { code: "DUPLICATE_ADAPTER" });
  assert.equal(hub.get(a), da);
  assert.deepEqual(state.routes, [a]);
});

test("leaf replacement/cleanup and complete hub disposal never dispose owned account delegates", () => {
  const { hub, state } = fixture();
  let disposed = 0;
  const da = { ...delegate(a, "A"), dispose() { disposed++; } };
  const handle = hub.registerAdapter([a], da);
  handle.replace([a]);
  assert.equal(state.replacements, 1);
  handle(); handle();
  assert.equal(hub.has(a), false);
  const again = hub.registerAdapter([a], da);
  hub.dispose(); hub.dispose(); again();
  assert.deepEqual(state.routes, []);
  assert.equal(disposed, 0);
  assert.throws(() => hub.registerAdapter([a], da), { code: "ACCOUNT_UNAVAILABLE" });
});

const root = new URL("../../dsh-session-account-review/installed/dsh/node_modules/", import.meta.url);
const llmUrl = new URL("@deepseek-ai/dsh-llm/lib/index.js", root);
test("real LlmRuntime keeps tagged replay across shared routes but removes raw legacy native replay", { skip: existsSync(llmUrl) ? false : "optional installed fixture absent" }, async () => {
  const [{ Context }, { LlmRuntime, LlmAdapter }] = await Promise.all([
    import(new URL("@deepseek-ai/cordis/lib/index.js", root).href), import(llmUrl.href),
  ]);
  const ctx = new Context(), llm = new LlmRuntime(ctx), captures = [];
  const hub = createCopilotRouteHub({ LlmAdapter, llm });
  class Probe extends LlmAdapter {
    providerInfo(id) { return { id, name: id }; }
    async resolveModel(provider, id) { return { provider, id, name: id }; }
    async *stream(options) { captures.push(options); yield { type: "finish", reason: { kind: "stop" } }; }
  }
  llm.registerAdapter(["github-copilot"], new Probe());
  hub.registerAdapter([a], new Probe()); hub.registerAdapter([b], new Probe()); hub.registerAdapter([GLOBAL_COPILOT_ROUTE], new Probe());
  const messages = [
    { role: "assistant", content: [{ type: "text", text: "A" }], source: { kind: "model", provider: a, model: "m", replayState: { accountId: "A", native: "FAKE_A_REPLAY" } } },
    { role: "assistant", content: [{ type: "text", text: "legacy" }], source: { kind: "model", provider: "github-copilot", model: "m", replayState: { native: "UNPROVEN_LEGACY_REPLAY" } } },
  ];
  for await (const _chunk of llm.stream({ provider: GLOBAL_COPILOT_ROUTE, model: "m", messages })) { /* no wire */ }
  assert.equal(captures.length, 1);
  assert.deepEqual(captures[0].messages[0].source.replayState, messages[0].source.replayState, "account validator must receive tagged state before deciding trust");
  assert.equal(captures[0].messages[1].source.replayState, undefined, "legacy native provider belongs to another adapter");
  hub.dispose(); await ctx.fiber.dispose();
});
