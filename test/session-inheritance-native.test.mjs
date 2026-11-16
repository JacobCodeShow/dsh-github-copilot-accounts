// Optional installed-code verification. All Sessions/data/services below are NEW
// synthetic fixtures; no user's Sessions, credentials, app or real model is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile, readFile, realpath, lstat, rm } from "node:fs/promises";
import { dirname, basename, join, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { accountRouteId, isAccountRoute } from "../src/account-route-id.mjs";
import { createSubagentAccountPolicy } from "../src/subagent-account-policy.mjs";

const root = new URL("../../dsh-session-account-review/installed/dsh/node_modules/@deepseek-ai/", import.meta.url);
const present = existsSync(new URL("dsh-session/lib/index.js", root));
const native = (name) => import(new URL(`${name}/lib/index.js`, root).href);
const nativeOptions = { skip: present ? false : "optional extracted DSH installation fixture absent" };
const PA = accountRouteId("copilot-auth/account-synthetic-a"), PB = accountRouteId("copilot-auth/account-synthetic-b"), PC = accountRouteId("copilot-auth/account-synthetic-c");
const route = (provider) => ({ provider, model: "synthetic-model", reasoningEffort: "high" });
let cached;
async function core() {
  cached ??= Promise.all([native("cordis"), native("dsh-session"), native("dsh-agent"), native("dsh-llm")]).then(([cordis, session, agent, llm]) => ({ ...cordis, ...session, ...agent, ...llm }));
  return cached;
}
function noNetwork(t) {
  const previous = globalThis.fetch; let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw new Error("native inheritance fixture forbids network"); };
  t.after(() => { globalThis.fetch = previous; assert.equal(attempts, 0); });
}
function selection(c, session, options = { provider: "github-copilot", model: "creation-fallback" }) {
  const read = () => session.snapshotEvents().reduce(c.modelSelectionProjectionDefinition.apply, c.modelSelectionProjectionDefinition.init());
  return new c.AgentModel(read, session, options);
}
function header(session, config, reason = "initial") { return session.append("request/header", { header: { config: { ...config } }, reason }); }
function detached(c, id, cwd, extra = {}) {
  return c.Session.create(id, undefined, { version: 4, id, createdAt: 1000, cwd, isSeeded: false, delegationDepth: 0, ...extra });
}
function fakeLlm(c, context, providers) {
  const requests = [], resolutions = [];
  class Adapter extends c.LlmAdapter {
    providerInfo(provider) { return { id: provider, name: "Synthetic " + provider }; }
    async resolveModel(provider, model) { resolutions.push({ provider, model }); return { provider, id: model, name: "Synthetic model", inputModalities: ["text"], context: { contextWindow: 32000 }, reasoning: { efforts: [{ id: "high", name: "High" }] } }; }
    async *stream(options) {
      requests.push(options);
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: "Synthetic title" };
      yield { type: "block-end", index: 0, block: { type: "text", text: "Synthetic title" } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
  const llm = new c.LlmRuntime(context);
  llm.registerAdapter(providers, new Adapter());
  return { llm, requests, resolutions };
}
function liveContext(c, t) {
  const context = new c.Context(); new c.SessionStore(context); new c.AgentRegistry(context);
  const detach = [];
  t.after(async () => { for (const release of detach.reverse()) release(); await context.fiber.dispose(); });
  return { context, enter(agent, parent) { detach.push(context.agents.enter(agent, parent)); } };
}
function turnHistory(c, context) {
  const parent = context.sessions.create("synthetic-parent", { meta: { cwd: fileURLToPath(new URL("..", import.meta.url)), delegationDepth: 0, createdAt: 1000 } });
  const model = selection(c, parent);
  model.select(route(PA)); parent.append("turn/start", { turn: 1 });
  const firstHeader = header(parent, route(PA));
  const completed = parent.append("turn/end", { turn: 1, reason: { kind: "completed" } });
  model.select(route(PB)); const pendingB = parent.snapshotEvents().at(-1);
  parent.append("turn/start", { turn: 2 }); header(parent, route(PB), "change");
  model.select(route(PC));
  const options = { provider: "github-copilot", model: "creation-fallback", maxTokens: 111 };
  const agent = { id: parent.id, ctx: context, session: parent, model, options };
  return { parent, agent, model, firstHeader, completed, pendingB };
}

// Fresh directory is pinned to this test checkout, never an ambient DSH_HOME.
const artifactBase = fileURLToPath(new URL("../.test-artifacts/", import.meta.url));
async function freshTemp() {
  assert.ok(isAbsolute(artifactBase)); assert.ok(!artifactBase.toLowerCase().includes("onedrive"));
  const worktree = await realpath(fileURLToPath(new URL("..", import.meta.url)));
  assert.ok(!worktree.toLowerCase().includes("onedrive"));
  await mkdir(artifactBase, { recursive: true });
  const actualBase = await realpath(artifactBase);
  assert.ok(!actualBase.toLowerCase().includes("onedrive"));
  return mkdtemp(join(artifactBase, "session-inheritance-native-"));
}
async function checkedCleanup(target) {
  const base = await realpath(artifactBase), resolved = await realpath(target), info = await lstat(target);
  const child = relative(base, resolved);
  assert.ok(isAbsolute(resolved)); assert.ok(info.isDirectory() && !info.isSymbolicLink());
  assert.ok(child !== "" && !child.startsWith("..") && !child.includes(sep));
  assert.ok(basename(resolved).startsWith("session-inheritance-native-"));
  await rm(resolved, { recursive: true }); // Resolved exact private test directory verified above.
}

test("native Session v4 codec + JSONL read restore retain public account route and pending selection", nativeOptions, async (t) => {
  noNetwork(t);
  const c = await core(), [{ sessionFormatCatalog }, jsonl] = await Promise.all([native("dsh-session-format-catalog"), native("dsh-session-persistence-jsonl")]);
  const temp = await freshTemp(), workspace = join(temp, "workspace"), storeRoot = join(temp, "Sessions-fixture");
  await mkdir(workspace); await mkdir(storeRoot);
  const context = new c.Context(); let handle;
  try {
    await jsonl.apply(context, { root: storeRoot, compression: "none", listConcurrency: 1 });
    const session = detached(c, "synthetic-persistence", workspace), model = selection(c, session);
    model.select(route(PA));
    session.append("turn/start", { turn: 1 }); header(session, route(PA));
    session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
    model.select(route(PB));
    const beforeHeader = JSON.stringify(session.header);
    const path = context.sessionPersistence.locate(session.header).path;
    const within = relative(storeRoot, path); assert.ok(within !== "" && !within.startsWith("..") && !isAbsolute(within));
    await mkdir(dirname(path), { recursive: true });
    // Native codec produces the physical current-format rows. Fixture writer is
    // plain fs; native Windows writer locks/fsync are NOT claimed by this test.
    const rows = [sessionFormatCatalog.encodeCurrentHeader(session.header, 0), ...session.snapshotEvents().map((event) => sessionFormatCatalog.encodeCurrentEvent(event))];
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { flag: "wx" });
    const firstLine = (await readFile(path, "utf8")).split("\n")[0];
    handle = await context.sessionPersistence.open(session.id, "read");
    const loaded = await handle.read();
    const restored = c.Session.fromRestore(session.id, loaded.events, structuredClone(handle.header), handle.inheritedEventCount, loaded.eventState);
    const defaultsChanged = { provider: PC, model: "different-global-default" };
    assert.equal(selection(c, restored, defaultsChanged).current().provider, PB, "pending durable choice wins new global default");
    assert.equal(restored.requestHeader().config.provider, PA, "last used route remains separately recorded");
    assert.deepEqual(restored.snapshotEvents().filter((event) => event.type === "model/selection").map((event) => event.data.provider), [PA, PB]);
    assert.equal(JSON.stringify(session.header), beforeHeader, "creation header is never rewritten");
    await handle.close(); handle = undefined;
    assert.equal((await readFile(path, "utf8")).split("\n")[0], firstLine, "read/resume does not rewrite persisted immutable header");
    const secondRoot = new c.Context();
    try {
      await jsonl.apply(secondRoot, { root: storeRoot, compression: "none", listConcurrency: 1 });
      const reopened = await secondRoot.sessionPersistence.open(session.id, "read");
      try {
        const again = await reopened.read();
        const resumedAgain = c.Session.fromRestore(session.id, again.events, structuredClone(reopened.header), reopened.inheritedEventCount, again.eventState);
        assert.equal(selection(c, resumedAgain, defaultsChanged).current().provider, PB, "new backend instance restores the same public route");
      } finally { await reopened.close(); }
    } finally { await secondRoot.fiber.dispose(); }
  } finally { if (handle) await handle.close(); await context.fiber.dispose(); await checkedCleanup(temp); }
});

test("ordinary native SessionStore forks inherit selected prefix, never later parent pending changes", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), { context } = liveContext(c, t), h = turnHistory(c, context);
  const oldPrefix = context.sessions.fork(h.parent, h.completed.seq, "synthetic-ui-prefix-a");
  const pendingPrefix = context.sessions.fork(h.parent, h.pendingB.seq, "synthetic-ui-prefix-b");
  assert.equal(selection(c, oldPrefix).current().provider, PA);
  assert.equal(selection(c, pendingPrefix).current().provider, PB);
  assert.equal(h.model.current().provider, PC);
  h.model.select(route(PA));
  assert.equal(selection(c, pendingPrefix).current().provider, PB);
  assert.equal(oldPrefix.header.origin, undefined, "ordinary UI fork is not a native subagent creation");
});

test("native child option inheritance uses committed last header, not pending choice", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), sub = await native("dsh-subagent"), { context } = liveContext(c, t), h = turnHistory(c, context);
  assert.equal(h.model.current().provider, PC); assert.equal(h.parent.requestHeader().config.provider, PB);
  assert.equal(sub.parentAgentOptionsForDelegation(h.agent).provider, PB);
  const inherited = sub.resolveChildAgentOptions(h.agent, undefined, 1);
  assert.equal(inherited.provider, PB); assert.equal(inherited.reasoningEffort, "high"); assert.equal(inherited.maxTokens, 111);
  const explicit = sub.resolveChildAgentOptions(h.agent, { provider: PC, model: "other" }, 1);
  assert.equal(explicit.provider, PC); assert.equal(explicit.reasoningEffort, undefined);
  const blank = context.sessions.create("synthetic-blank-parent"); const pending = selection(c, blank); pending.select(route(PB));
  assert.equal(sub.parentAgentOptionsForDelegation({ session: blank, options: { provider: "github-copilot", model: "creation" } }).provider, "github-copilot", "before any request native helper falls back to creation options, not pending state");
});

test("native tool-fork seed can override inherited options until awaited created hook appends own selection", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), sub = await native("dsh-subagent"), fork = await native("dsh-subagent-fork-in-process"), { context, enter } = liveContext(c, t), h = turnHistory(c, context);
  const wire = fakeLlm(c, context, [PB]);
  let provider; fork.apply({ subagents: { registerProvider(value) { provider = value; } } }, { providerName: "fork" });
  const prepared = await provider.prepareContinuable({ parent: h.agent });
  assert.equal(prepared.seed.at(-1).type, "turn/end"); assert.equal(prepared.seed.at(-1).seq, h.completed.seq);
  assert.ok(!prepared.seed.some((event) => event.type === "model/selection" && event.data.provider === PB));
  const options = sub.resolveChildAgentOptions(h.agent, undefined, 1);
  const child = context.sessions.create("synthetic-new-fork-child", { seed: prepared.seed, inheritedEventCount: prepared.seed.length,
    meta: { parentSession: h.parent.id, isSeeded: true, origin: "subagent", delegationDepth: 1 } });
  const descriptor = sub.snapshotSubagentDescriptor({ mode: "continuable", provider: "fork", label: "synthetic", agentProvider: options.provider, agentModel: options.model, agentReasoningEffort: options.reasoningEffort });
  child.append("subagent/descriptor", descriptor);
  const machine = { id: child.id, ctx: context, session: child, options, model: selection(c, child, options) };
  const { createScope } = await native("dsh-scope");
  machine.scope = createScope(context, machine, { parent: h.agent });
  machine.ctx = machine.scope.ctx; // Actual Cordis traced descendant services.
  assert.equal(options.provider, PB);
  assert.equal(machine.model.current().provider, PA, "actual seeded projection wins constructor fallback options");
  const prefix = child.snapshotEvents(0, child.inheritedEventCount), parentBefore = h.parent.snapshotEvents();
  const { SessionQueryEngine } = await native("dsh-session-query");
  new SessionQueryEngine(context);
  const policy = createSubagentAccountPolicy({ context, isAccountRoute, ownsRoute: (value) => value === PB,
    originalSymbol: c.symbols.original, LlmError: c.LlmError });
  let observed = false;
  context.on("agent/created", async (event) => { if (await policy(event)) observed = true; });
  enter(h.agent); await context.agents.announce(h.agent, "startup");
  enter(machine, h.agent);
  assert.equal(context.agents.isOwnedBy(machine.id, h.agent), true);
  await context.agents.announce(machine, "startup", new AbortController().signal);
  assert.equal(observed, true); assert.equal(machine.model.current().provider, PB);
  assert.deepEqual(child.snapshotEvents(0, child.inheritedEventCount), prefix);
  assert.deepEqual(h.parent.snapshotEvents(), parentBefore);
  assert.equal(child.requestHeader().config.provider, PA, "new control record does not rewrite historical header");
  assert.equal(child.snapshotEvents().at(-1).type, "model/selection");
  assert.equal(child.snapshotEvents().at(-1).data.provider, PB);
  assert.equal(wire.requests.length, 0, "all correction and validation occurs before any protocol stream");
});

test("creation policy preserves an explicit child-owned current-lifecycle route", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), sub = await native("dsh-subagent"), fork = await native("dsh-subagent-fork-in-process"), { context, enter } = liveContext(c, t), h = turnHistory(c, context);
  const wire = fakeLlm(c, context, [PB, PC]);
  const { SessionQueryEngine } = await native("dsh-session-query"); new SessionQueryEngine(context);
  let provider; fork.apply({ subagents: { registerProvider(value) { provider = value; } } }, { providerName: "fork" });
  const prepared = await provider.prepareContinuable({ parent: h.agent }), options = sub.resolveChildAgentOptions(h.agent, undefined, 1);
  const child = context.sessions.create("synthetic-explicit-child", { seed: prepared.seed, inheritedEventCount: prepared.seed.length,
    meta: { parentSession: h.parent.id, isSeeded: true, origin: "subagent", delegationDepth: 1 } });
  child.append("subagent/descriptor", sub.snapshotSubagentDescriptor({ mode: "continuable", provider: "fork", label: "synthetic", agentProvider: options.provider, agentModel: options.model, agentReasoningEffort: options.reasoningEffort }));
  const model = selection(c, child, options); model.select(route(PC));
  const before = child.snapshotEvents();
  const machine = { id: child.id, ctx: context, session: child, options, model };
  context.on("agent/created", createSubagentAccountPolicy({ context, isAccountRoute, ownsRoute: (value) => value === PB || value === PC, originalSymbol: c.symbols.original, LlmError: c.LlmError }));
  enter(h.agent); await context.agents.announce(h.agent, "startup"); enter(machine, h.agent);
  await context.agents.announce(machine, "startup");
  assert.deepEqual(child.snapshotEvents(), before); assert.equal(model.current().provider, PC);
  const call = await context.llm.prepareCall(model.current());
  assert.equal(call.config.provider, PC); assert.equal(wire.requests.length, 0);
});

test("new native spawn child uses inherited committed route without fork history ambiguity", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), sub = await native("dsh-subagent"), spawn = await native("dsh-subagent-spawn-in-process"), { context } = liveContext(c, t), h = turnHistory(c, context);
  let provider; spawn.apply({ subagents: { registerProvider(value) { provider = value; } } }, { providerName: "spawn" });
  const prepared = await provider.prepareContinuable({ parent: h.agent });
  assert.equal(prepared.seed, undefined);
  const options = sub.resolveChildAgentOptions(h.agent, undefined, 1);
  const child = context.sessions.create("synthetic-spawn-child", { meta: { parentSession: h.parent.id, isSeeded: false, origin: "subagent", delegationDepth: 1 } });
  const model = selection(c, child, options);
  assert.equal(model.current().provider, PB);
  h.model.select(route(PC));
  assert.equal(model.current().provider, PB, "later parent pending state does not rebind existing child options");
});

test("matched missing child account aborts real native announcement before startup continuation", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), sub = await native("dsh-subagent"), fork = await native("dsh-subagent-fork-in-process"), { context, enter } = liveContext(c, t), h = turnHistory(c, context);
  const wire = fakeLlm(c, context, [PA, "github-copilot"]);
  const { SessionQueryEngine } = await native("dsh-session-query"); new SessionQueryEngine(context);
  let provider; fork.apply({ subagents: { registerProvider(value) { provider = value; } } }, { providerName: "fork" });
  const prepared = await provider.prepareContinuable({ parent: h.agent }), options = sub.resolveChildAgentOptions(h.agent, undefined, 1);
  const child = context.sessions.create("synthetic-missing-account-child", { seed: prepared.seed, inheritedEventCount: prepared.seed.length,
    meta: { parentSession: h.parent.id, isSeeded: true, origin: "subagent", delegationDepth: 1 } });
  child.append("subagent/descriptor", sub.snapshotSubagentDescriptor({ mode: "continuable", provider: "fork", label: "synthetic", agentProvider: options.provider, agentModel: options.model, agentReasoningEffort: options.reasoningEffort }));
  const machine = { id: child.id, ctx: context, session: child, options, model: selection(c, child, options) };
  context.on("agent/created", createSubagentAccountPolicy({ context, isAccountRoute, ownsRoute: () => false, originalSymbol: c.symbols.original, LlmError: c.LlmError }));
  enter(h.agent); await context.agents.announce(h.agent, "startup"); enter(machine, h.agent);
  let startupContinued = false;
  await assert.rejects((async () => { await context.agents.announce(machine, "startup"); startupContinued = true; })(), { code: "ACCOUNT_UNAVAILABLE" });
  assert.equal(startupContinued, false); assert.equal(wire.requests.length, 0); assert.equal(wire.resolutions.length, 0);
  assert.equal(machine.model.current().provider, PA, "old prefix is not rewritten or dispatched after the rejected announcement");
});

test("cold child resume reads its immutable descriptor and preserves child's own subsequent selection", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), sub = await native("dsh-subagent"), { context } = liveContext(c, t), h = turnHistory(c, context);
  const child = context.sessions.create("synthetic-existing-child", { meta: { parentSession: h.parent.id, origin: "subagent", delegationDepth: 1 } });
  const descriptorA = sub.snapshotSubagentDescriptor({ mode: "continuable", provider: "spawn", label: "existing", agentProvider: PA, agentModel: "synthetic-model" });
  child.append("subagent/descriptor", descriptorA);
  selection(c, child).select(route(PC));
  const attemptedRewrite = { type: "subagent/descriptor", seq: child.seq, time: Date.now(), data: sub.snapshotSubagentDescriptor({ mode: "continuable", provider: "spawn", label: "must not rewrite first", agentProvider: PB, agentModel: "synthetic-model" }) };
  assert.equal(sub.foldSubagentDescriptor([...child.snapshotEvents(), attemptedRewrite]).agentProvider, PA, "first descriptor also wins an adversarial duplicate fold input");
  let inputs, disposedObservation = false;
  const receiver = {
    requireSessionQuery() { return { async observeSession(id) { assert.equal(id, child.id); return { header: child.header, inheritedEventCount: 0, events: child.snapshotEvents(), [Symbol.dispose]() { disposedObservation = true; } }; } }; },
    assertAdmitting(parent) { assert.equal(parent, h.agent); },
    authorizeLineage(parent, id, parentSession) { assert.equal(parentSession, parent.id); assert.equal(id, child.id); },
    async materialize(value) { inputs = value; return { synthetic: true }; },
    async submitMaterialized(activation) { assert.equal(activation.synthetic, true); return "synthetic-message"; },
  };
  context.provide("workingDirectory", { async set() { throw new Error("fixture must not materialize a real child"); } });
  context.provide("sessionProjections", { async register() { return {}; } });
  await context.plugin(sub.SubagentRuntime, {});
  await context.inject(["agents", "subagents"], () => {});
  const runtime = context.subagents;
  assert.ok(runtime.manager);
  // Manager is constructed by the real exported runtime on this private Context.
  // Invoke its unchanged method with stubbed observation/materialization only;
  // no child Agent/loop/provider or model request is actually started.
  const coldResume = Object.getPrototypeOf(runtime.manager).coldResume;
  assert.equal(typeof coldResume, "function");
  const result = await coldResume.call(receiver, h.agent, child.id, [{ type: "text", text: "synthetic" }], { signal: new AbortController().signal });
  assert.equal(result, "synthetic-message"); assert.equal(inputs.agentOptions.provider, PA);
  assert.equal(selection(c, child, inputs.agentOptions).current().provider, PC, "child's own durable selection still wins descriptor fallback");
  assert.equal(disposedObservation, true);
});

test("unavailable recorded public route fails native LLM resolution instead of global fallback", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), { context } = liveContext(c, t);
  const wire = fakeLlm(c, context, ["github-copilot", PB]);
  const session = detached(c, "synthetic-unavailable", fileURLToPath(new URL("..", import.meta.url)));
  session.append("turn/start", { turn: 1 }); header(session, route(PA));
  session.append("turn/end", { turn: 1, reason: { kind: "completed" } });
  await assert.rejects(context.llm.prepareCall(session.requestHeader().config), { code: "NO_ADAPTER" });
  assert.equal(wire.requests.length, 0); assert.equal(wire.resolutions.length, 0);
});

test("native title helper follows recorded account unless an auxiliary route override is configured", nativeOptions, async (t) => {
  noNetwork(t); const c = await core(), titles = await native("dsh-session-title-llm"), { context } = liveContext(c, t);
  const wire = fakeLlm(c, context, [PA, PC]);
  const session = context.sessions.create("synthetic-title");
  const user = c.createUserMessage({ content: [{ type: "text", text: "Synthetic title source" }], source: { kind: "synthetic-fixture" } });
  const event = session.append("user/message", user, { surfaceOp: "append" });
  session.append("turn/start", { turn: 1 }); header(session, route(PA)); selection(c, session).select(route(PB));
  const request = { session, route: { provider: session.requestHeader().config.provider, model: session.requestHeader().config.model }, signal: new AbortController().signal };
  const prepared = { system: "Synthetic title prompt", input: "Synthetic input", messageSeqs: [event.seq], selectReasoningEffort: () => undefined };
  const limits = { maxInputBytes: 4096, maxOutputTokens: 20, timeoutMs: 1000 };
  const inherited = await titles.executeSessionTitleLlm(context, titles.resolveSessionTitleLlmConfig(limits), request, "synthetic-title-provider", prepared);
  assert.equal(inherited.model.provider, PA);
  const overridden = await titles.executeSessionTitleLlm(context, titles.resolveSessionTitleLlmConfig({ ...limits, provider: PC, model: "override-model" }), request, "synthetic-title-provider", prepared);
  assert.equal(overridden.model.provider, PC); assert.equal(overridden.model.model, "override-model");
  assert.deepEqual(wire.requests.map((options) => options.provider), [PA, PC]);
  assert.ok(wire.requests.every((options) => options.purpose === "session-title"));
  assert.equal(session.snapshotEvents().filter((row) => row.type === "session/title-llm-request").at(-1).data.route.provider, PC);
});
