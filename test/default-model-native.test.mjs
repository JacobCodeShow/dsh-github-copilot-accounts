// Optional real installation-source integration. No profile/account/credential
// data or application startup; all sessions and config writes below are fake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { accountRouteId, GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
import { SESSION_LLM_PUBLIC_METHODS } from "../src/session-catalog-policy.mjs";
import { installDefaultModelPolicy, installRestartBoundary } from "../src/default-model.mjs";

const modules = new URL("../../dsh-session-account-review/installed/dsh/node_modules/", import.meta.url);
const url = (path) => new URL(path, modules);
const present = ["@deepseek-ai/cordis/lib/index.js", "@deepseek-ai/cordis-plugin-loader/lib/index.js", "@deepseek-ai/cordis-plugin-include/lib/index.js", "@deepseek-ai/dsh-agent-default-model/lib/index.js", "@deepseek-ai/dsh-api-session-controller/lib/index.js", "js-yaml/index.js"].every((path) => existsSync(url(path)));
const options = { skip: present ? false : "optional complete extracted Cordis/DSH installation fixture absent" };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function runtime(t) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail("Network forbidden in offline default-model test"); };
  t.after(() => { globalThis.fetch = previous; });
  const [cordis, loader, include, native, protocol] = await Promise.all([
    import(url("@deepseek-ai/cordis/lib/index.js").href), import(url("@deepseek-ai/cordis-plugin-loader/lib/index.js").href),
    import(url("@deepseek-ai/cordis-plugin-include/lib/index.js").href), import(url("@deepseek-ai/dsh-agent-default-model/lib/index.js").href),
    import(url("@deepseek-ai/dsh-typert-protocol/lib/index.js").href),
  ]);
  return { ...cordis, ...protocol, Loader: loader.default, applyPatches: include.applyEntryPatches, NativeDefault: native.default };
}

async function fixture(t, { pending = false, controllerScoped = true, llmScoped = true, expectedModuleName = "cordis:controller", managedReady = false, catalogCheck = false } = {}) {
  const api = await runtime(t), root = new api.Context();
  const writes = [], selections = [], gate = deferred(), started = deferred();
  let concurrent = 0, maxConcurrent = 0, failNext = false;
  const llm = Object.fromEntries(SESSION_LLM_PUBLIC_METHODS.map((method) => [method, () => undefined]));
  llm.listProviders = () => [{id:"github-copilot"},{id:GLOBAL_COPILOT_ROUTE},{id:"other-provider"}];
  let managedModels = [{id:"gpt-5.4"}];
  llm.listModels = async (provider) => provider === GLOBAL_COPILOT_ROUTE ? managedModels : [{id:"gpt-5.4"}];
  llm.resolveCallConfig = async (value) => value;
  root.provide("llm", llm);
  let engineReady = managedReady;
  root.provide("copilotManagedDefault", {version:1,isReady:()=>engineReady});
  root.provide("configEditor", { async edit(entry, change) {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    try {
      await Promise.resolve();
      if (failNext) { failNext = false; throw new Error("mock native save failure"); }
      const config = change(structuredClone(entry.options.config));
      writes.push({ id: entry.options.id, config });
      await entry.update({ config });
    } finally { concurrent--; }
  } });
  await root.plugin(api.Loader);
  const source = await readFile(url("@deepseek-ai/dsh-api-session-controller/lib/index.js"), "utf8");
  const start = source.indexOf("async selectModel(request) {");
  const end = source.indexOf("\n\t}\n\t/**", start) + 4;
  assert.ok(start > 0 && end > start);
  const actualMethod = source.slice(start, end);
  assert.ok(actualMethod.includes("this.ctx.agentDefaultModel.saveSelection(selected)"));
  // Execute the exact installed stock method, replacing only its collaborators
  // with fake model admission/Agent objects; no method on a real service changes.
  const availableStart=source.indexOf("async function modelAvailable(ctx, selection) {");
  const availableEnd=source.indexOf("\n}",availableStart)+2;
  const modelAvailable=new Function("RemoteError",`return (${source.slice(availableStart,availableEnd)})`)(api.RemoteError);
  const Commands = new Function("ReasoningEffortId", "RemoteError", "remoteErrorOf", "modelAvailable", `return class {
    constructor(ctx) { this.ctx=ctx; this.agents={serializeImageAdmission:(_,fn)=>fn()}; }
    resolveAgent() { return Promise.resolve({model:{select:(value)=>this.capture(value)}}); }
    async requireModel(request) { this.started(); await this.wait(); if(this.catalogCheck && !await modelAvailable(this.ctx,request)) throw new RemoteError("session/model-unavailable","Model unavailable",{}); }
    ${actualMethod}
  }`)((value) => value, api.RemoteError, api.remoteErrorOf, modelAvailable);
  class Controller extends api.Service {
    static inject = ["agentDefaultModel", "llm"];
    constructor(ctx) {
      super(ctx, "proofController");
      this.commands = new Commands(ctx);
      this.commands.catalogCheck = catalogCheck;
      this.commands.capture = (value) => selections.push(value);
      this.commands.started = () => started.resolve();
      this.commands.wait = () => pending ? gate.promise : Promise.resolve();
    }
    selectModel(request) { return this.commands.selectModel(request); }
    currentSelection() { return this.commands.ctx.agentDefaultModel.currentSelection(); }
    catalogProviders() { return this.commands.ctx.llm.listProviders(); }
    catalogModels(provider) { return this.commands.ctx.llm.listModels(provider); }
  }
  root.loader.builtins["native-default"] = { default: api.NativeDefault };
  root.loader.builtins["policy"] = { apply(ctx) { installDefaultModelPolicy(ctx, api.Context, { controllerModuleName: expectedModuleName }); } };
  root.loader.builtins["controller"] = { default: Controller };
  const alias = accountRouteId("copilot-auth/account-native-proof");
  const raw = { id: "agent-default-model", name: "cordis:native-default", config: { provider: "other-provider", model: "global-original", reasoningEffort: "high" } };
  const consumer = { id: "session-controller", name: "cordis:controller", ...(controllerScoped ? { isolate: { agentDefaultModel: "copilot-session-default-model", ...(llmScoped ? {llm:"copilot-session-llm"} : {}) } } : {}) };
  const policy = { id: "copilot-default-model-policy", name: "cordis:policy", isolate: { agentDefaultModel: "copilot-session-default-model", llm:"copilot-session-llm" } };
  await root.loader.root.update([raw, consumer, policy]);
  await root.loader.await();
  t.after(() => root.fiber.dispose());
  const marker = root.get("copilotDefaultModelPolicy");
  assert.equal(marker.version, 1);
  const controller = root.get("proofController");
  return { api, root, writes, selections, gate, started, marker, controller, alias, raw, consumer, policy,
    setManagedReady(value) {engineReady=value;}, setManagedModels(value) {managedModels=value;},
    maxConcurrent: () => maxConcurrent,
    failNext: () => { failNext = true; },
    async removePolicy() {
      const entry = root.loader.resolve("copilot-default-model-policy"), fiber = entry.fiber;
      root.loader.remove("copilot-default-model-policy");
      await fiber.await();
    },
  };
}

test("real patch DSL preserves original default entry and guards controller by name", options, async (t) => {
  const { applyPatches } = await runtime(t);
  const original = [{ id: "agent-default-model", name: "@deepseek-ai/dsh-agent-default-model", config: {provider:"other-provider",model:"kept"} }, {id:"session-controller",name:"@deepseek-ai/dsh-api-session-controller"}];
  const source=parseYaml(await readFile(new URL("../cordis.patch.yml",import.meta.url),"utf8"));
  const patches=source.flatMap((row)=>row.id==="session-controller"?[row]:(row.insert??[]).some((entry)=>entry.id==="copilot-default-model-policy")?[{insert:row.insert.filter((entry)=>entry.id==="copilot-default-model-policy")}]:[]);
  const warnings = [], composed = applyPatches(original, patches, (...args) => warnings.push(args));
  assert.deepEqual(composed[0], original[0]);
  assert.equal(composed[1].name, original[1].name);
  assert.deepEqual(composed[1].isolate,{agentDefaultModel:"copilot-session-default-model",llm:"copilot-session-llm"});
  assert.deepEqual(composed.find((row)=>row.id==="copilot-default-model-policy").isolate,composed[1].isolate);
  assert.equal(warnings.length, 0);
});

test("real native schema, serialized saver and captured stock controller stay intact", options, async (t) => {
  const f = await fixture(t);
  const entry = f.root.loader.resolve("agent-default-model");
  assert.equal(entry.fiber.runtime.Config, f.api.NativeDefault.Config);
  const nativeImpl = f.root.reflect.store[f.root[f.api.Context.isolate].agentDefaultModel].uid;
  const request = (provider, model, reasoningEffort) => ({sessionId:"fake-session",provider,model,reasoningEffort});
  await f.controller.selectModel(request(f.alias,"bound-only","low"));
  await f.marker.withSessionSelectionOnly(() => f.controller.selectModel(request("github-copilot","unbind-only","medium")));
  assert.equal(f.writes.length,0);
  await Promise.all([f.controller.selectModel(request("github-copilot","native-choice","low")), f.controller.selectModel(request("other-provider","other-choice","medium"))]);
  await f.root.get("agentDefaultModel").saves;
  assert.equal(f.maxConcurrent(),1);
  assert.deepEqual(f.writes.map((row)=>row.id),["agent-default-model","agent-default-model"]);
  assert.deepEqual(f.writes.map((row)=>row.config),[{provider:"github-copilot",model:"native-choice",reasoningEffort:"low"},{provider:"other-provider",model:"other-choice",reasoningEffort:"medium"}]);
  assert.equal(f.root.reflect.store[f.root[f.api.Context.isolate].agentDefaultModel].uid,nativeImpl);
  const raw = f.root.get("agentDefaultModel");
  f.failNext();
  const failed = raw.saveSelection({provider:"other-provider",model:"fails"});
  const recovers = raw.saveSelection({provider:"other-provider",model:"after-failure"});
  await assert.rejects(failed,/mock native save failure/); await recovers;
  assert.equal(raw.currentSelection().model,"after-failure");
});

test("actual stock model admission rejects builtin bypass only when managed engine is ready", options, async (t) => {
  const f=await fixture(t,{catalogCheck:true});
  const entry=f.root.loader.resolve("agent-default-model");
  await entry.update({config:{provider:"github-copilot",model:"gpt-5.4",reasoningEffort:"high"}});
  assert.equal(f.controller.currentSelection().provider,"github-copilot");
  f.setManagedReady(true);
  assert.equal(f.controller.currentSelection().provider,GLOBAL_COPILOT_ROUTE);
  assert.equal(f.root.get("agentDefaultModel").currentSelection().provider,"github-copilot");
  assert.equal(f.controller.catalogProviders().some((row)=>row.id==="github-copilot"),false);
  assert.equal(f.root.get("llm").listProviders().some((row)=>row.id==="github-copilot"),true);
  await assert.rejects(f.controller.selectModel({sessionId:"fake-session",provider:"github-copilot",model:"gpt-5.4"}),(error)=>error.code==="session/model-unavailable");
  assert.equal(f.writes.length,0);
  await f.controller.selectModel({sessionId:"fake-session",provider:GLOBAL_COPILOT_ROUTE,model:"gpt-5.4",reasoningEffort:"low"});
  await f.root.get("agentDefaultModel").saves;
  assert.equal(f.selections.at(-1).provider,GLOBAL_COPILOT_ROUTE);
  assert.deepEqual(f.writes.at(-1).config,{provider:"github-copilot",model:"gpt-5.4",reasoningEffort:"low"});
  f.setManagedModels([]); // NoDefault != unsupported engine.
  assert.deepEqual(await f.controller.catalogModels(GLOBAL_COPILOT_ROUTE),[]);
  assert.equal(f.controller.catalogProviders().some((row)=>row.id==="github-copilot"),false);
  f.setManagedReady(false);
  assert.equal(f.controller.currentSelection().provider,"github-copilot");
  assert.equal(f.controller.catalogProviders().some((row)=>row.id==="github-copilot"),true);
});

for (const removedService of ["agentDefaultModel","llm"]) for (const order of ["controller-first","policy-first"]) {
  for (const kind of ["alias","native-unbind"]) {
    test(`real pending stock ${kind}: ${order} ${removedService} teardown fails closed until restart`, options, async (t) => {
      const f = await fixture(t,{pending:true});
      const request = {sessionId:"fake-session",provider:kind==="alias"?f.alias:"github-copilot",model:"pending-choice"};
      const invoke = () => f.controller.selectModel(request);
      const pending = kind==="alias" ? invoke() : f.marker.withSessionSelectionOnly(invoke);
      const settled = pending.then((value)=>({ok:true,value}),(error)=>({ok:false,error}));
      await f.started.promise;
      const entry = f.root.loader.resolve("session-controller");
      const previousLabel = entry.ctx[f.api.Context.isolate].agentDefaultModel;
      const previousLlm = entry.ctx[f.api.Context.isolate].llm;
      if (order==="policy-first") await f.removePolicy();
      const nextScope={...entry.options.isolate};delete nextScope[removedService];
      await assert.rejects(entry.update({isolate:nextScope}), (error)=>error.code==="COPILOT_RESTART_REQUIRED" && /full DSH restart/.test(error.message));
      // Entry.options changed before the hook; the actual context must NOT move.
      assert.equal(entry.options.isolate[removedService],undefined);
      assert.equal(entry.ctx[f.api.Context.isolate].agentDefaultModel,previousLabel);
      assert.equal(entry.ctx[f.api.Context.isolate].llm,previousLlm);
      if (order==="controller-first") await f.removePolicy();
      assert.equal(f.marker.active,false);
      assert.throws(()=>f.marker.withSessionSelectionOnly(()=>assert.fail("stale marker invoked")),/policy is unavailable/);
      f.gate.resolve();
      await settled; // unavailable old controller may reject, but never saves globally
      await f.root.get("agentDefaultModel").saves;
      assert.equal(f.writes.length,0);
      assert.deepEqual(f.root.get("agentDefaultModel").currentSelection(),{provider:"other-provider",model:"global-original",reasoningEffort:"high"});
      await assert.rejects(entry.update({config:{unrelated:true}}),(error)=>error.code==="COPILOT_RESTART_REQUIRED");
    });
  }
}

test("real alive standalone policy fails closed for skipped or mismatched controller patches", options, async (t) => {
  for (const settings of [{controllerScoped:false}, {llmScoped:false}, {expectedModuleName:"@deepseek-ai/dsh-api-session-controller"}]) {
    const f = await fixture(t,settings);
    assert.equal(f.marker.version,1);
    assert.equal(f.marker.active,true);
    assert.equal(f.marker.isControllerProtected(),false);
    let invoked = false;
    assert.throws(()=>f.marker.withSessionSelectionOnly(()=>{invoked=true;}),/policy is unavailable/);
    assert.equal(invoked,false);
    assert.equal(f.writes.length,0);
  }
});

test("same-realm controller reload, native default writes and cold stock startup remain allowed", options, async (t) => {
  const f = await fixture(t);
  const entry = f.root.loader.resolve("session-controller");
  await entry.update({config:{sameRealmReload:true}});
  await f.root.loader.await();
  await f.root.get("proofController").selectModel({sessionId:"fake-session",provider:"other-provider",model:"ordinary-choice"});
  await f.root.get("agentDefaultModel").saves;
  assert.equal(f.writes.length,1);
  const policyEntry = f.root.loader.resolve("copilot-default-model-policy");
  installRestartBoundary(policyEntry.fiber.ctx,f.api.Context); // root guard is idempotent
  const cold = new f.api.Context();
  t.after(()=>cold.fiber.dispose());
  cold.provide("configEditor",{edit:async()=>{}});
  await cold.plugin(f.api.Loader);
  cold.loader.builtins["native"]={default:f.api.NativeDefault};
  await cold.loader.root.update([{id:"agent-default-model",name:"cordis:native",config:{provider:"other-provider",model:"cold-stock"}}]);
  await cold.loader.await();
  assert.ok(cold.get("agentDefaultModel") instanceof f.api.NativeDefault);
  assert.equal(cold.get("copilotDefaultModelPolicy"),undefined);
  assert.equal(cold.get("agentDefaultModel").currentSelection().model,"cold-stock");
});
