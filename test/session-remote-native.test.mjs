// Optional real Gateway/SRC integration using only installation code and fake
// peers/Sessions. No transport listener, app startup, credentials or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createSessionRemoteService } from "../src/session-remote.mjs";
import { createSessionAccountClient } from "../src/session-client.mjs";

const modules = new URL("../../dsh-session-account-review/installed/dsh/node_modules/", import.meta.url);
const url = (path) => new URL(path, modules);
const present = ["@deepseek-ai/cordis/lib/index.js", "@deepseek-ai/dsh-api-gateway/lib/index.js", "@deepseek-ai/dsh-typert-registry/lib/index.js", "@deepseek-ai/dsh-typert-protocol/lib/index.js", "ws/index.js", "zod/index.js"].every((path) => existsSync(url(path)));
const options = { skip: present ? false : "optional complete extracted Gateway fixture absent" };
const ID = "copilot-auth/account-a";
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const peer = (kind = "owner", id = "owner-A") => ({ id, principal: { kind }, signal: new AbortController().signal, interactions: "answer" });
const state = (sessionId) => ({sessionId,running:false,next:{provider:"github-copilot",model:"gpt-5.4",mode:"global",accountId:null,available:true},lastUsed:{mode:"inactive",accountId:null,available:false}});

async function fixture(t, changes = {}) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail("Network forbidden in native Remote proof"); };
  t.after(() => { globalThis.fetch = previous; });
  const [cordis, protocol, registry, gatewayModule] = await Promise.all([
    import(url("@deepseek-ai/cordis/lib/index.js").href), import(url("@deepseek-ai/dsh-typert-protocol/lib/index.js").href),
    import(url("@deepseek-ai/dsh-typert-registry/lib/index.js").href), import(url("@deepseek-ai/dsh-api-gateway/lib/index.js").href),
  ]);
  const root = new cordis.Context(), observations = [], resources = [], handlers = [];
  t.after(() => root.fiber.dispose());
  class Access extends cordis.Service {
    constructor(ctx) { super(ctx,"remoteAccess"); }
    decide(request) { resources.push(request); return {kind:"allow"}; } // maximally permissive viewer policy; bridge must still deny
    allows(resource) {
      const invocation = this.ctx.invocation;
      observations.push({resource,peer:invocation?.peer.id,kind:invocation?.peer.principal.kind,method:invocation?.request.method});
      return changes.allowed ? changes.allowed(resource,invocation) : true;
    }
  }
  await root.plugin(registry.default);
  await root.plugin(Access);
  const RemoteClass = createSessionRemoteService({ ...protocol,
    createCoordinator(authorize) { return {
      async read(request) {
        if (!await authorize(request.sessionId,"read")) throw Object.assign(new Error("private"),{code:"SESSION_FORBIDDEN"});
        if (changes.read) return changes.read(request,authorize);
        if (request.sessionId==="subagent") throw Object.assign(new Error("private"),{code:"SESSION_UNAVAILABLE"});
        return state(request.sessionId);
      },
      async bind(request) {
        if (!await authorize(request.sessionId,"write")) throw Object.assign(new Error("private"),{code:"SESSION_FORBIDDEN"});
        return {accepted:{provider:"github-copilot",model:"gpt-5.4"},...state(request.sessionId)};
      },
    }; },
    handlers: {
      async catalog(request,ctx) { handlers.push({method:"catalog",peer:ctx.invocation.peer.id,sessionId:request.sessionId}); return [{id:ID,domain:changes.domain??"company.ghe.com",login:"alice",payload:{refresh:"FAKE_SECRET"}}]; },
      async profile(request,ctx) { handlers.push({method:"profile",peer:ctx.invocation.peer.id}); return {ok:true,avatarUrl:"https://company.ghe.com/image?fixture=opaque",refresh:"FAKE_SECRET"}; },
      async setDefault(request,ctx) { handlers.push({method:"setDefault",peer:ctx.invocation.peer.id}); return {ok:true,defaultAccountId:ID,refresh:"FAKE_SECRET"}; },
    },
  });
  await root.plugin(RemoteClass);
  await root.plugin(gatewayModule.TypertGatewayService,{});
  const gateway = root.get("typertGateway");
  const call = (method,request,identity = peer()) => gateway.invokeRpc(`copilotAccounts/${method}`,{args:{request}},undefined,identity);
  return {root,gateway,call,observations,resources,handlers,protocol};
}

test("real Gateway discovers manual Remote markers in SRC mode and propagates owner invocation", options, async (t) => {
  const f = await fixture(t);
  for (const method of ["catalog","bind","profile","setDefault"]) assert.equal(f.gateway.claimsEndpoint(`copilotAccounts/${method}`),true);
  assert.equal(f.gateway.claimsEndpoint("copilotAccounts/invokeAccountOperation"),false);
  const result = await f.call("catalog",{sessionId:"s"});
  assert.equal(result.ok,true);
  assert.equal(result.value.sessionId,"s");
  assert.equal(result.value.accounts[0].id,ID);
  assert.equal(JSON.stringify(result).includes("FAKE_SECRET"),false);
  assert.ok(f.observations.every((seen)=>seen.peer==="owner-A" && seen.kind==="owner"));
  assert.deepEqual(f.handlers,[{method:"catalog",peer:"owner-A",sessionId:"s"}]);
  const descriptor = f.gateway.resolveDescriptor("copilotAccounts","catalog","copilotAccounts/catalog");
  assert.equal(descriptor.id.startsWith("src:"),true);
  assert.deepEqual(descriptor.parameters.map((param)=>param.wire),["request"]);
  assert.equal((await f.call("profile",{sessionId:"s",accountId:ID})).value.avatarUrl,"https://company.ghe.com/image?fixture=opaque");
  assert.deepEqual((await f.call("setDefault",{sessionId:"s",accountId:ID})).value,{ok:true,defaultAccountId:ID});
  assert.equal((await f.call("bind",{sessionId:"s",accountId:ID})).value.accepted.provider,"github-copilot");
});

test("real Gateway resource metadata does not make permissive non-owner policy an account owner", options, async (t) => {
  const f = await fixture(t);
  for (const method of ["catalog","bind","profile","setDefault"]) {
    const result = await f.call(method,{sessionId:"s",accountId:ID},peer("share-viewer","viewer"));
    assert.equal(result.ok,false);
    assert.equal(result.error.code,"OWNER_REQUIRED");
    assert.equal(result.error.details.status,403);
  }
  assert.equal(f.handlers.length,0);
  assert.ok(f.resources.every((entry)=>entry.resources.some((resource)=>resource.kind==="session" && resource.id==="s")));
  await assert.rejects(f.root.get("copilotAccounts").catalog({sessionId:"s"}),(error)=>error.code==="OWNER_REQUIRED");
});

test("real concurrent Gateway calls keep invocation principal and authorization separate", options, async (t) => {
  const entered = deferred(), release = deferred();
  let allowed = true;
  const f = await fixture(t,{allowed:(_,invocation)=>allowed && invocation.peer.id==="owner-A",read:async(request)=>{entered.resolve();await release.promise;return state(request.sessionId);}});
  const first = f.call("catalog",{sessionId:"a"},peer("owner","owner-A"));
  await entered.promise;
  const second = await f.call("catalog",{sessionId:"b"},peer("owner","owner-B"));
  assert.equal(second.ok,false);
  assert.equal(second.error.code,"SESSION_FORBIDDEN");
  allowed = false;
  release.resolve();
  const result = await first;
  assert.equal(result.ok,false);
  assert.equal(result.error.code,"SESSION_FORBIDDEN");
  assert.equal(f.handlers.length,0);
  assert.ok(f.observations.some((seen)=>seen.peer==="owner-B"));
  assert.ok(f.observations.filter((seen)=>seen.resource.id==="a").every((seen)=>seen.peer==="owner-A"));
});

test("production Session client uses the selected Host Gateway even for identical Session/account ids", options, async (t) => {
  const a = await fixture(t,{domain:"host-a.ghe.com"}), b = await fixture(t,{domain:"host-b.ghe.com"});
  const make = (host,id) => {
    const generation = {host:id};
    const connection = {generation:{getSnapshot:()=>generation},rpc:{call:(channel,endpoint,payload,signal)=>{
      assert.equal(channel,"/api");
      return host.gateway.invokeRpc(endpoint,payload,signal,peer("owner",id));
    }}};
    return createSessionAccountClient({sessionId:"same-session-id",connection,isCurrent:()=>true});
  };
  const clientA = make(a,"owner-host-A"), clientB = make(b,"owner-host-B");
  assert.equal((await clientA.catalog()).accounts[0].domain,"host-a.ghe.com");
  assert.equal((await clientB.catalog()).accounts[0].domain,"host-b.ghe.com");
  await clientB.setDefault({accountId:ID});
  assert.ok(a.handlers.every((call)=>call.peer==="owner-host-A" && call.method!=="setDefault"));
  assert.ok(b.handlers.every((call)=>call.peer==="owner-host-B"));
  clientA.dispose();clientB.dispose();
});

test("real Gateway validates named request carrier and ordinary Session before account mutations", options, async (t) => {
  const f = await fixture(t);
  for (const method of ["profile","setDefault"]) {
    const denied = await f.call(method,{sessionId:"subagent",accountId:ID});
    assert.equal(denied.error.code,"SESSION_UNAVAILABLE");
  }
  assert.equal(f.handlers.length,0);
  const malformed = await f.gateway.invokeRpc("copilotAccounts/catalog",{args:{sessionId:"s"}},undefined,peer());
  assert.equal(malformed.ok,false);
  assert.equal(f.handlers.length,0);
});
