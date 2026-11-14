import { test } from "node:test";
import { accountCredentialIdentity } from "../src/account-identity.mjs";
import assert from "node:assert/strict";
import { createSessionRequestState, createSessionRequestProjection } from "../src/session-request-state.mjs";
import { accountRouteId, GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
const A="copilot-auth/account-a",B="copilot-auth/account-b",RA=accountRouteId(A),RB=accountRouteId(B);
const codec={parse:(value)=>structuredClone(value)};
const Schema={object:()=>codec,union:()=>codec,const:()=>codec,natural:()=>codec,string:()=>codec,boolean:()=>codec};
const uuidFactory=()=>{let index=0;return()=>`00000000-0000-4000-8000-${(++index).toString(16).padStart(12,"0")}`;};
const session=(id="s")=>({id,events:[],push(type,data){const event={seq:this.events.length,type,data};this.events.push(event);return event;}});
const input=(accountId=A,logicalProvider=RA,extra={})=>({sessionId:"s",accountId,credentialIdentity:accountCredentialIdentity({type:"oauth",refresh:`FAKE_${accountId}`,enterpriseUrl:accountId===A?"a.ghe.com":"b.ghe.com"}),logicalProvider,model:"model",reasoningEffort:"high",apiContext:"anthropic-messages",...extra});
function projections(){const definitions=[],handles=[];return{definitions,handles,async register(definition){definitions.push(definition);const handle={disposed:false,stateOf:(owner)=>owner.events.reduce(definition.apply,definition.init()),async dispose(){handle.disposed=true;}};handles.push(handle);return handle;}};}
async function fixture(){const owner=session(),registry=projections(),lookup=new Map([["s",owner]]),uuid=uuidFactory();const manager=await createSessionRequestState({sessionProjections:registry,Schema,resolveSession:(id)=>lookup.get(id),hostNonce:"host-1",uuid});return{owner,registry,lookup,uuid,manager};}
function envelope(scope){return{kind:"copilot-account",version:1,accountId:scope.cacheMeta.accountId,credentialIdentity:scope.cacheMeta.credentialIdentity,cache:scope.cacheMeta,native:{response:{provider:"github-copilot",model:scope.cacheMeta.model,api:scope.cacheMeta.apiContext},blocks:[{thinkingSignature:"FAKE_SIGNATURE"}]}};}
function success(owner,scope){const replayState=envelope(scope);return owner.push("assistant/message",{message:{source:{provider:scope.cacheMeta.logicalProvider,model:scope.cacheMeta.model,replayState}},stream:[{type:"chunk",time:1,chunk:{type:"finish",reason:{kind:"stop"},replayState}}]});}

 test("projection uses only known v4 selection/header/attempt/message and preserves unrelated state reference",()=>{
  const def=createSessionRequestProjection(Schema),initial=def.init();
  assert.equal(def.apply(initial,{seq:0,type:"user/message",data:{}}),initial);
  const selected=def.apply(initial,{seq:1,type:"model/selection",data:{provider:RA,model:"model",reasoningEffort:"high"}});
  assert.equal(selected.selectionSeq,1);
  assert.equal(def.apply(selected,{seq:2,type:"request/header",data:{header:{config:{provider:RA,model:"model",reasoningEffort:"high"}}}}),selected);
  assert.equal(def.apply(selected,{seq:3,type:"assistant/attempt",data:{stream:[]}}).failureSeq,3);
});

test("same successful scope reuses crypto and wire; same-id cold resume changes wire only",async()=>{
  const f=await fixture();f.owner.push("model/selection",{provider:RA,model:"model",reasoningEffort:"high"});
  const first=await f.manager.scopeForRequest(input());success(f.owner,first);
  const again=await f.manager.scopeForRequest(input());assert.equal(again.replayEpoch,first.replayEpoch);assert.equal(again.transportSessionId,first.transportSessionId);
  const cold=await createSessionRequestState({sessionProjections:f.registry,Schema,resolveSession:()=>f.owner,hostNonce:"host-2",uuid:uuidFactory()});
  const resumed=await cold.scopeForRequest(input());assert.equal(resumed.replayEpoch,first.replayEpoch);assert.equal(resumed.contextKey,first.contextKey);assert.notEqual(resumed.transportSessionId,first.transportSessionId);
  await cold.dispose();await f.manager.dispose();
});

test("A reply -> B reply -> A never resurrects any older A crypto epoch",async()=>{
  const f=await fixture();f.owner.push("model/selection",{provider:RA,model:"model"});
  const a=await f.manager.scopeForRequest(input());success(f.owner,a);
  f.owner.push("model/selection",{provider:RB,model:"model"});const b=await f.manager.scopeForRequest(input(B,RB));success(f.owner,b);
  f.owner.push("model/selection",{provider:RA,model:"model"});const back=await f.manager.scopeForRequest(input());
  assert.notEqual(back.replayEpoch,a.replayEpoch);assert.notEqual(back.replayEpoch,b.replayEpoch);assert.notEqual(back.transportSessionId,a.transportSessionId);
  await f.manager.dispose();
});

test("A -> B without B reply -> A keeps required A crypto but rotates transport",async()=>{
  const f=await fixture();f.owner.push("model/selection",{provider:RA,model:"model"});const a=await f.manager.scopeForRequest(input());success(f.owner,a);
  f.owner.push("model/selection",{provider:RB,model:"model"});f.owner.push("model/selection",{provider:RA,model:"model"});
  const back=await f.manager.scopeForRequest(input());assert.equal(back.replayEpoch,a.replayEpoch);assert.equal(back.contextKey,a.contextKey);assert.notEqual(back.transportSessionId,a.transportSessionId);
  await f.manager.dispose();
});

test("same account alias <-> global, defaultEpoch, effort and purpose change transport not crypto",async()=>{
  const f=await fixture();const a=await f.manager.scopeForRequest(input());success(f.owner,a);
  for(const extra of [{logicalProvider:GLOBAL_COPILOT_ROUTE,defaultEpoch:"global-2"},{reasoningEffort:"low"},{purpose:"compaction"},{defaultEpoch:"global-3"}]){
    const changed=await f.manager.scopeForRequest(input(A,RA,extra));assert.equal(changed.replayEpoch,a.replayEpoch);assert.equal(changed.contextKey,a.contextKey);assert.notEqual(changed.transportSessionId,a.transportSessionId);
  }
  await f.manager.dispose();
});

test("same-account compaction and network/429 failed attempts retain required crypto but rotate wire",async()=>{
  const f=await fixture();const a=await f.manager.scopeForRequest(input());success(f.owner,a);
  f.owner.push("compaction/end",{compactionId:"fixture",turn:null});
  const compacted=await f.manager.scopeForRequest(input());assert.equal(compacted.replayEpoch,a.replayEpoch);assert.notEqual(compacted.transportSessionId,a.transportSessionId);
  f.owner.push("assistant/attempt",{stream:[]});const failed=await f.manager.scopeForRequest(input());
  assert.equal(failed.replayEpoch,a.replayEpoch);assert.equal(failed.contextKey,a.contextKey);assert.notEqual(failed.transportSessionId,compacted.transportSessionId);
  await f.manager.dispose();
});

test("model/API/fork identity changes require new crypto; raw native success is untrusted",async()=>{
  const f=await fixture();const a=await f.manager.scopeForRequest(input());success(f.owner,a);
  assert.notEqual((await f.manager.scopeForRequest(input(A,RA,{model:"other-model"}))).contextKey,a.contextKey);
  assert.notEqual((await f.manager.scopeForRequest(input(A,RA,{apiContext:"openai-responses"}))).contextKey,a.contextKey);
  const child=session("fork-child");child.events=structuredClone(f.owner.events);f.lookup.set(child.id,child);
  const fork=await f.manager.scopeForRequest(input(A,RA,{sessionId:child.id}));assert.notEqual(fork.contextKey,a.contextKey);assert.notEqual(fork.replayEpoch,a.replayEpoch);
  f.owner.push("assistant/message",{message:{source:{provider:"github-copilot",model:"model",replayState:envelope(a)}}});
  assert.notEqual((await f.manager.scopeForRequest(input())).replayEpoch,a.replayEpoch);
  await f.manager.dispose();
});

test("unknown or absent Session never reads another Session or restores trusted replay",async()=>{
  const f=await fixture();const first=await f.manager.scopeForRequest(input(A,RA,{sessionId:undefined})),second=await f.manager.scopeForRequest(input(A,RA,{sessionId:undefined}));
  assert.equal(first.cacheMeta.trusted,false);assert.notEqual(first.replayEpoch,second.replayEpoch);assert.notEqual(first.transportSessionId,second.transportSessionId);
  const missing=await f.manager.scopeForRequest(input(A,RA,{sessionId:"not-live"}));assert.equal(missing.cacheMeta.trusted,false);
  f.lookup.set("wrong",f.owner);assert.equal((await f.manager.scopeForRequest(input(A,RA,{sessionId:"wrong"}))).cacheMeta.trusted,false);
  await assert.rejects(f.manager.scopeForRequest(input(A,RA,{sessionId:42})),(error)=>error.code==="INVALID_ACCOUNT_SCOPE");
  await f.manager.dispose();
});

test("manual transport reset preserves crypto; explicit replay reset alone invalidates it",async()=>{
  const f=await fixture();const a=await f.manager.scopeForRequest(input());success(f.owner,a);
  f.manager.reset("s");const transport=await f.manager.scopeForRequest(input());assert.equal(transport.replayEpoch,a.replayEpoch);assert.notEqual(transport.transportSessionId,a.transportSessionId);
  f.manager.resetReplay("s");const crypto=await f.manager.scopeForRequest(input());assert.notEqual(crypto.contextKey,a.contextKey);assert.notEqual(crypto.replayEpoch,a.replayEpoch);
  assert.equal(JSON.stringify(f.manager.notice("s")).includes("FAKE_SIGNATURE"),false);await f.manager.dispose();
});

test("malformed or inconsistent persisted metadata cannot restore an epoch",async()=>{
  const f=await fixture(),a=await f.manager.scopeForRequest(input());const event=success(f.owner,a);
  event.data.message.source.replayState.cache={...a.cacheMeta,contextKey:"0".repeat(64)};
  assert.notEqual((await f.manager.scopeForRequest(input())).replayEpoch,a.replayEpoch);
  await f.manager.dispose();
});

function observer(f,{ownsAgent}={}){
  const hooks=new Map();let releases=0;
  const ctx={on(name,fn,options){assert.ok(["agent/request","agent/request-error"].includes(name));assert.deepEqual(options,{prepend:true,global:true});hooks.set(name,fn);return()=>{releases++;};}};
  f.manager.observeFailures(ctx,{isManagedProvider:(provider)=>[RA,RB,GLOBAL_COPILOT_ROUTE].includes(provider),ownsAgent});
  let selected={provider:RA,model:"model"};
  const agent={session:f.owner,rootRealm:true,model:{current:()=>selected}};
  return{agent,request:hooks.get("agent/request"),error:hooks.get("agent/request-error"),select:(provider,model="model")=>{selected={provider,model};},releases:()=>releases};
}

test("correlated switch failure preserves native retry/error flow and publishes only safe identifiers",async()=>{
  const f=await fixture(),a=await f.manager.scopeForRequest(input());success(f.owner,a);const o=observer(f);o.select(RB);
  const payload={agent:o.agent,provider:RB,turn:2,step:1,failure:{message:"FAKE_PRIVATE_URL"},signal:new AbortController().signal};
  const proposed={provider:RB,model:"model"};assert.equal(await o.request(payload,async()=>proposed),proposed);
  await f.manager.scopeForRequest(input(B,RB));
  const retry={kind:"retry"};assert.equal(await o.error(payload,async()=>retry),retry);assert.equal(f.manager.notice("s"),null);
  const original=new Error("native next failure");await assert.rejects(o.error(payload,async()=>{throw original;}),(error)=>error===original);
  assert.equal(await o.error(payload,async()=>undefined),undefined);
  const notice=f.manager.notice("s");assert.equal(notice.code,"ACCOUNT_REQUEST_FAILED");assert.equal(notice.accountId,B);assert.equal(notice.logicalProvider,RB);assert.equal(JSON.stringify(notice).includes("FAKE_PRIVATE_URL"),false);
  await o.error(payload,async()=>undefined);assert.deepEqual(f.manager.notice("s"),notice);
  assert.equal((await f.manager.scopeForRequest(input())).replayEpoch,a.replayEpoch);
  await f.manager.dispose();assert.equal(o.releases(),2);assert.equal(f.registry.handles[0].disposed,true);
  await assert.rejects(f.manager.scopeForRequest(input()),(error)=>error.code==="ACCOUNT_REQUEST_STATE_UNAVAILABLE");
});

test("routine same-account quota/network failure resets transport without a popup",async()=>{
  const f=await fixture(),a=await f.manager.scopeForRequest(input());success(f.owner,a);const o=observer(f);
  const payload={agent:o.agent,provider:RA,turn:2,step:1,signal:new AbortController().signal};
  await o.request(payload,async()=>({provider:RA,model:"model"}));await f.manager.scopeForRequest(input());
  await o.error(payload,async()=>undefined);assert.equal(f.manager.notice("s"),null);
  const next=await f.manager.scopeForRequest(input());assert.notEqual(next.transportSessionId,a.transportSessionId);assert.equal(next.replayEpoch,a.replayEpoch);await f.manager.dispose();
});

test("new preparation clears old ticket and stale failure from an old selection is suppressed",async()=>{
  const f=await fixture(),a=await f.manager.scopeForRequest(input());success(f.owner,a);const o=observer(f);o.select(RB);
  const payload={agent:o.agent,provider:RB,turn:2,step:1,signal:new AbortController().signal};
  await o.request(payload,async()=>({provider:RB,model:"model"}));await f.manager.scopeForRequest(input(B,RB));
  o.select(RA);await o.error(payload,async()=>undefined);assert.equal(f.manager.notice("s"),null);
  o.select(RB);const next={...payload,turn:3};
  const error=new Error("preparation failed");await assert.rejects(o.request(next,async()=>{throw error;}),(caught)=>caught===error);
  await o.error(next,async()=>undefined);assert.equal(f.manager.notice("s"),null);await f.manager.dispose();
});

test("colliding SID or isolated same-Session Agent cannot clear tickets/notices or reset transport",async()=>{
  const f=await fixture(),a=await f.manager.scopeForRequest(input());success(f.owner,a);
  const o=observer(f,{ownsAgent:(agent)=>agent.rootRealm===true});o.select(RB);
  const payload={agent:o.agent,provider:RB,turn:2,step:1,signal:new AbortController().signal};
  await o.request(payload,async()=>({provider:RB,model:"model"}));await f.manager.scopeForRequest(input(B,RB));await o.error(payload,async()=>undefined);
  const notice=f.manager.notice("s"),before=await f.manager.scopeForRequest(input(B,RB));success(f.owner,before);
  for(const agent of [{session:session("s"),rootRealm:true},{session:f.owner,rootRealm:false}]){
    const foreign={...payload,agent,turn:9};
    const proposed={provider:RA,model:"model"};assert.equal(await o.request(foreign,async()=>proposed),proposed);
    await o.error(foreign,async()=>undefined);
    assert.deepEqual(f.manager.notice("s"),notice);
    assert.equal((await f.manager.scopeForRequest(input(B,RB))).transportSessionId,before.transportSessionId);
  }
  await f.manager.dispose();
});

test("auxiliary scopes never replace the matching conversation request plan",async()=>{
  const f=await fixture(),a=await f.manager.scopeForRequest(input());success(f.owner,a);const o=observer(f);o.select(RB);
  const payload={agent:o.agent,provider:RB,turn:2,step:1,signal:new AbortController().signal};
  await o.request(payload,async()=>({provider:RB,model:"model"}));await f.manager.scopeForRequest(input(B,RB));
  await f.manager.scopeForRequest(input(A,RA,{purpose:"compaction"}));await o.error(payload,async()=>undefined);
  assert.equal(f.manager.notice("s").accountId,B);await f.manager.dispose();
});
