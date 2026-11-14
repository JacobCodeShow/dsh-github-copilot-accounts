// Optional real v4 Session/projection/native pi-ai integration. All records,
// credentials and protocol output are synthetic; no app/network/user state.
import { test } from "node:test";
import { accountCredentialIdentity } from "../src/account-identity.mjs";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createSessionRequestState } from "../src/session-request-state.mjs";
import { createAccountAdapter } from "../src/account-adapter.mjs";
import { accountRouteId, GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
import { ACCOUNT_REQUEST_CONTEXT } from "../src/account-request-context.mjs";
const modules=new URL("../../dsh-session-account-review/installed/dsh/node_modules/",import.meta.url);
const url=(path)=>new URL(path,modules);
const present=["@deepseek-ai/cordis/lib/index.js","@deepseek-ai/dsh-session/lib/index.js","@deepseek-ai/dsh-session-projection/lib/index.js","@deepseek-ai/schemastery/lib/index.mjs","@deepseek-ai/dsh-llm/lib/index.js","@deepseek-ai/dsh-llm-pi-ai/lib/index.js"].every((path)=>existsSync(url(path)));
const options={skip:present?false:"optional extracted v4 Session/projection/native adapter fixture absent"};
const A="copilot-auth/account-a",B="copilot-auth/account-b",RA=accountRouteId(A),RB=accountRouteId(B);
const uuidFactory=()=>{let index=0;return()=>`10000000-0000-4000-8000-${(++index).toString(16).padStart(12,"0")}`;};
let imported;
async function core(){return imported??=Promise.all([
  import(url("@deepseek-ai/cordis/lib/index.js").href),import(url("@deepseek-ai/dsh-session/lib/index.js").href),
  import(url("@deepseek-ai/dsh-session-projection/lib/index.js").href),import(url("@deepseek-ai/schemastery/lib/index.mjs").href),
  import(url("@deepseek-ai/dsh-llm/lib/index.js").href),import(url("@deepseek-ai/dsh-llm-pi-ai/lib/index.js").href),
  import(url("@earendil-works/pi-ai/dist/providers/github-copilot.js").href),
]).then(([cordis,session,projection,schema,llm,pi,provider])=>({...cordis,...session,...llm,...pi,...provider,Projection:projection.default,Schema:schema.default}));}
async function fixture(t,{hostNonce="host-A",seed,id="native-s"}={}){
  const previous=globalThis.fetch;globalThis.fetch=async()=>assert.fail("Network forbidden in native scope tests");t.after(()=>{globalThis.fetch=previous;});
  const c=await core(),ctx=new c.Context();new c.SessionStore(ctx);new c.Projection(ctx);t.after(()=>ctx.fiber.dispose());
  const session=ctx.sessions.create(id,{...(seed===undefined?{}:{seed,inheritedEventCount:id==="fork-child"?seed.length:0}),meta:{createdAt:1000,delegationDepth:0,isSeeded:id==="fork-child"}});
  const manager=await createSessionRequestState({sessionProjections:ctx.sessionProjections,Schema:c.Schema,resolveSession:(sid)=>ctx.sessions.get(sid),hostNonce,uuid:uuidFactory(),lastAssistantStreamChunk:c.lastAssistantStreamChunk});
  t.after(()=>manager.dispose());
  return{c,ctx,session,manager};
}
const input=(session,accountId=A,logicalProvider=RA,extra={})=>({sessionId:session.id,accountId,credentialIdentity:accountCredentialIdentity({type:"oauth",refresh:`FAKE_${accountId}`,enterpriseUrl:accountId===A?"a.ghe.com":"b.ghe.com"}),logicalProvider,model:"model",reasoningEffort:"high",apiContext:"anthropic-messages",...extra});
function envelope(scope){return{kind:"copilot-account",version:1,accountId:scope.cacheMeta.accountId,credentialIdentity:scope.cacheMeta.credentialIdentity,cache:scope.cacheMeta,native:{response:{kind:"pi-ai",version:2,provider:"github-copilot",api:scope.cacheMeta.apiContext,model:scope.cacheMeta.model,stopReason:"stop"},blocks:[{type:"text"}]}};}
function appendSuccess(c,session,scope){
  const replayState=envelope(scope),acc=new c.AssistantStreamAccumulator();
  const chunks=[{type:"block-start",index:0,blockType:"text"},{type:"text-delta",index:0,text:"synthetic"},{type:"block-end",index:0,block:{type:"text",text:"synthetic"}},{type:"finish",reason:{kind:"stop"},replayState}];
  chunks.forEach((chunk,index)=>acc.push({time:1000+index,chunk}));
  const message=c.createAssistantMessage({content:[{type:"text",text:"synthetic"}],source:{provider:scope.cacheMeta.logicalProvider,model:scope.cacheMeta.model,replayState}});
  return session.append("assistant/message",{turn:1,step:1,message,stream:acc.snapshot()},{surfaceOp:"append"});
}

test("real v4 projection restores cold same-account crypto, resets fork and A/B/A reply context",options,async(t)=>{
  const f=await fixture(t);f.session.append("model/selection",{provider:RA,model:"model",reasoningEffort:"high"});
  const first=await f.manager.scopeForRequest(input(f.session));appendSuccess(f.c,f.session,first);
  const seed=f.session.snapshotEvents(); // TEST-only deprecated reader allowance, never production
  const cold=await fixture(t,{hostNonce:"host-B",seed});
  const resumed=await cold.manager.scopeForRequest(input(cold.session));
  assert.equal(resumed.replayEpoch,first.replayEpoch);assert.notEqual(resumed.transportSessionId,first.transportSessionId);
  const reassigned=await fixture(t,{hostNonce:"host-other",seed});
  const foreign=await reassigned.manager.scopeForRequest(input(reassigned.session,A,RA,{credentialIdentity:accountCredentialIdentity({type:"oauth",enterpriseUrl:"other.ghe.com",refresh:"FAKE_OTHER_LONG"})}));
  assert.notEqual(foreign.contextKey,first.contextKey,"same SID and legacy slot on another grant/issuer must not restore crypto");
  const child=await fixture(t,{hostNonce:"host-C",seed,id:"fork-child"});
  assert.notEqual((await child.manager.scopeForRequest(input(child.session))).contextKey,first.contextKey);
  f.session.append("model/selection",{provider:RB,model:"model",reasoningEffort:"high"});
  const b=await f.manager.scopeForRequest(input(f.session,B,RB));appendSuccess(f.c,f.session,b);
  f.session.append("model/selection",{provider:RA,model:"model",reasoningEffort:"high"});
  const back=await f.manager.scopeForRequest(input(f.session));assert.notEqual(back.replayEpoch,first.replayEpoch);
});

test("real v4 failed compact stream and compaction lifecycle rotate wire but keep required own crypto",options,async(t)=>{
  const f=await fixture(t);const first=await f.manager.scopeForRequest(input(f.session));appendSuccess(f.c,f.session,first);
  const failure=new f.c.AssistantStreamAccumulator();failure.push({time:2000,chunk:{type:"finish",reason:{kind:"error",failure:{code:"RATE_LIMIT",message:"synthetic429"}}}});
  f.session.append("assistant/attempt",{turn:1,step:2,stream:failure.snapshot()});
  const retry=await f.manager.scopeForRequest(input(f.session));assert.equal(retry.replayEpoch,first.replayEpoch);assert.notEqual(retry.transportSessionId,first.transportSessionId);
  const compactionId="11111111-1111-4111-8111-111111111111";
  f.session.append("compaction/start",{compactionId,turn:null});f.session.append("compaction/end",{compactionId,turn:null});
  const compacted=await f.manager.scopeForRequest(input(f.session));assert.equal(compacted.replayEpoch,first.replayEpoch);assert.notEqual(compacted.transportSessionId,retry.transportSessionId);
});

test("real PiAiAdapter keeps original Host header context but native protocol sees scoped SDK Session UUID",options,async(t)=>{
  const f=await fixture(t),{c}=f,captures=[],hooks=[];
  const records=new Map([[A,{kind:"grant",payload:{type:"oauth",refresh:"FAKE_REFRESH",access:"FAKE_ACCESS",expires:Date.now()+3600000,enterpriseUrl:"company-a.ghe.com",account:{login:"alice"}}}]]);
  const credentials={async readRecord(id){return structuredClone(records.get(id));},async modifyRecord(id,mutate){const next=await mutate(structuredClone(records.get(id)));if(next!==undefined)records.set(id,structuredClone(next));return structuredClone(records.get(id));}};
  const createNativeProvider=()=>{
    const provider=c.githubCopilotProvider();
    provider.streamSimple=(model,context,options)=>{
      captures.push({model,context,options});
      return(async function*(){const content=[{type:"thinking",thinking:"fake reasoning",thinkingSignature:"FAKE_THINKING_SIGNATURE"},{type:"toolCall",id:"fake-tool",name:"lookup",arguments:{query:"safe"},thoughtSignature:"FAKE_TOOL_SIGNATURE"}];
        const message={role:"assistant",content,api:model.api,provider:model.provider,model:model.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"toolUse",timestamp:Date.now()};
        yield{type:"thinking_start",contentIndex:0};yield{type:"thinking_delta",contentIndex:0,delta:"fake reasoning"};yield{type:"thinking_end",contentIndex:0,content:"fake reasoning"};
        yield{type:"toolcall_start",contentIndex:1,partial:message};yield{type:"toolcall_delta",contentIndex:1,delta:'{"query":"safe"}'};yield{type:"toolcall_end",contentIndex:1,toolCall:content[1]};
        yield{type:"done",reason:"toolUse",message};})();
    };return provider;
  };
  const chosen=createNativeProvider().getModels().find((model)=>model.api==="anthropic-messages");assert.ok(chosen);
  const adapter=createAccountAdapter({LlmAdapter:c.LlmAdapter,LlmError:c.LlmError,PiAiAdapter:c.PiAiAdapter,createNativeProvider,credentials,accountId:A,routeId:RA,
    requestScope:f.manager.scopeForRequest,prepareHeaders:(request,headers)=>{hooks.push(request);headers.set("session_id","SHARED_WRONG");return headers;}});
  t.after(()=>adapter.dispose());
  const outer=Object.freeze({provider:RA,model:chosen.id,sessionId:f.session.id,reasoningEffort:"high",messages:[{role:"user",content:[{type:"text",text:"offline"}]}],tools:[],[ACCOUNT_REQUEST_CONTEXT]:Object.freeze({logicalProvider:GLOBAL_COPILOT_ROUTE,defaultEpoch:"default-v1"})});
  const chunks=[];for await(const chunk of adapter.stream(outer))chunks.push(chunk);
  const finish=chunks.find((chunk)=>chunk.type==="finish"),scope=finish.replayState.cache;
  assert.equal(scope.logicalProvider,GLOBAL_COPILOT_ROUTE);assert.equal(scope.accountId,A);
  assert.equal(outer.sessionId,f.session.id);assert.notEqual(captures[0].options.sessionId,f.session.id);
  assert.match(captures[0].options.sessionId,/^[a-f0-9-]{36}$/);
  assert.equal(captures[0].options.headers.session_id,captures[0].options.sessionId);
  assert.equal(hooks[0].sessionId,f.session.id);assert.equal(hooks[0].provider,GLOBAL_COPILOT_ROUTE);
  assert.equal(captures[0].options[ACCOUNT_REQUEST_CONTEXT],undefined);
  // Commit the actual assembled reasoning/tool response and opaque cache meta
  // through v4; the normative projection must restore it for a same-account
  // compaction/failure continuation without making a required signature empty.
  const assembler=new c.BlockAssembler(),compact=new c.AssistantStreamAccumulator();
  chunks.forEach((chunk,index)=>{assembler.push(chunk);compact.push({time:3000+index,chunk});});
  const message=c.createAssistantMessage({content:assembler.blocks(),source:{provider:GLOBAL_COPILOT_ROUTE,model:chosen.id,replayState:finish.replayState}});
  f.session.append("assistant/message",{turn:1,step:1,message,stream:compact.snapshot()},{surfaceOp:"append"});
  const failure=new c.AssistantStreamAccumulator();failure.push({time:4000,chunk:{type:"finish",reason:{kind:"error",failure:{code:"RATE_LIMIT",message:"fake429"}}}});
  f.session.append("assistant/attempt",{turn:1,step:2,stream:failure.snapshot()});
  const compactionId="22222222-2222-4222-8222-222222222222";
  f.session.append("compaction/start",{compactionId,turn:null});f.session.append("compaction/end",{compactionId,turn:null});
  const tool=c.createToolResultMessage({callId:"fake-tool",content:[{type:"text",text:"safe tool result"}],isError:false});
  f.session.append("tool/result",{turn:1,step:1,message:tool},{surfaceOp:"append"});
  const originalIdentity=finish.replayState.credentialIdentity;
  records.get(A).payload.access="FAKE_ROTATED_SHORT_ACCESS";
  const follow={...outer,messages:[...outer.messages,message,tool]};delete follow[ACCOUNT_REQUEST_CONTEXT];
  const continued=[];for await(const chunk of adapter.stream(follow))continued.push(chunk);
  const next=continued.find((chunk)=>chunk.type==="finish");
  assert.equal(next.replayState.cache.epoch,scope.epoch);
  assert.equal(next.replayState.credentialIdentity,originalIdentity);assert.equal(captures[1].options.apiKey,"FAKE_ROTATED_SHORT_ACCESS");
  assert.notEqual(captures[1].options.sessionId,captures[0].options.sessionId);
  const thinking=captures[1].context.messages.find((item)=>item.role==="assistant").content.find((item)=>item.type==="thinking");
  assert.equal(thinking.thinkingSignature,"FAKE_THINKING_SIGNATURE");
});
