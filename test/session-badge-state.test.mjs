import { test } from "node:test";
import assert from "node:assert/strict";
import { accountLabel, deriveSessionBadgeState, createSessionBadgeController, sessionBadgeErrorKey } from "../src/session-badge-state.mjs";
const A = "copilot-auth/account-a", B = "copilot-auth/account-b";
const ROUTE_A = `copilot-account-${"a".repeat(64)}`, ROUTE_B = `copilot-account-${"b".repeat(64)}`;
const rows = () => [
  {id:A,routeId:ROUTE_A,domain:"a.ghe.com",login:"alice",avatarUrl:"https://a.ghe.com/avatar",plan:"A",usage:{percentUsed:20}},
  {id:B,routeId:ROUTE_B,domain:"b.ghe.com",login:"alice",globalActive:true,active:true,plan:"B",usage:{percentUsed:90}},
];
const catalog = (mode = "bound") => ({sessionId:"s",running:false,next: mode === "bound" ? {mode,provider:ROUTE_A,model:"gpt-5.4",reasoningEffort:"high",accountId:A,available:true} : mode === "global" ? {mode,provider:"copilot-default",model:"gpt-5.4",reasoningEffort:"high",accountId:null,available:true} : {mode:"inactive",provider:"other-provider",model:"other-model",accountId:null,available:false},lastUsed:{mode:"inactive",accountId:null,available:false},accounts:rows()});
const deferred = () => {let resolve;const promise=new Promise((done)=>{resolve=done;});return{promise,resolve};};
function store(initial) {
  let value=initial;const listeners=new Set();
  return{getSnapshot:()=>value,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},set(next){value=next;for(const fn of [...listeners])fn();},count:()=>listeners.size};
}
function fixture(overrides = {}) {
  const calls=[],generation=store({host:"host-A",epoch:1}),projection=store({}),sessionState=store({running:false}),list=store({}),errorListeners=new Set();
  const remote={$on(event,listener){assert.equal(event,"api-session/error");errorListeners.add(listener);return()=>errorListeners.delete(listener);}};
  const makeScope=()=>({get:(name)=>{if(name==="remote")return remote;assert.equal(name,"connection");return connection;}});
  let data=catalog(),host="A",binding,scope;
  const connection={generation,rpc:{call:async(channel,endpoint,payload,signal)=>{
    const method=endpoint.split("/")[1],request=payload.args.request;
    calls.push({host,channel,method,request,signal});
    if(overrides.call){const result=overrides.call(method,request,host);if(result!==undefined)return result;}
    if(method==="catalog")return{ok:true,value:structuredClone(data)};
    if(method==="bind"){
      data={...data,next:{...data.next,mode:request.accountId===null?"global":"bound",provider:request.accountId===null?"copilot-default":request.accountId===A?ROUTE_A:ROUTE_B,accountId:request.accountId,available:true}};
      return{ok:true,value:{accepted:{provider:data.next.provider,model:data.next.model},...data}};
    }
    if(method==="setDefault"){
      data={...data,accounts:data.accounts.map((row)=>({...row,active:row.id===request.accountId,globalActive:row.id===request.accountId}))};
      return{ok:true,value:{ok:true,defaultAccountId:request.accountId}};
    }
    return{ok:true,value:{ok:true,avatarUrl:`https://${host}.ghe.com/fresh`}};
  }}};
  const makeBinding=()=>({session:{getSnapshot:sessionState.getSnapshot,subscribe:sessionState.subscribe,projections:{faceOf:()=>projection}}});
  binding=makeBinding();scope=makeScope();
  const sessions={binding:()=>binding,scope:()=>scope,list};
  const controller=createSessionBadgeController({sessionId:"s",sessions,imageCache:overrides.imageCache});
  return{controller,calls,connection,generation,projection,sessionState,list,sessions,errorListeners,
    emitError(id="s",raw="FAKE_PRIVATE_ERROR"){for(const listener of [...errorListeners])listener(id,raw);},
    data:()=>data,setData:(next)=>{data=next;},
    replaceBinding(){binding=makeBinding();scope=makeScope();list.set({});},
    switchHost(next){host=next;generation.set({host:`host-${next}`,epoch:2});},
  };
}

test("bound A identity and credit never follow globally active B",()=>{
  const view=deriveSessionBadgeState(catalog());
  assert.equal(view.account.id,A);assert.equal(view.plan,"A");assert.equal(view.remaining,80);
  assert.equal(view.globalAccountId,B);assert.equal(view.selectedAccountId,A);assert.equal(view.followsGlobal,false);
  assert.deepEqual(view.expected,{provider:ROUTE_A,model:"gpt-5.4",reasoningEffort:"high"});
  assert.equal(accountLabel(view.account),"a.ghe.com/alice");
});

test("only Follow-global mode uses the global default row",()=>{
  const view=deriveSessionBadgeState(catalog("global"));
  assert.equal(view.account.id,B);assert.equal(view.remaining,10);assert.equal(view.selectedAccountId,null);assert.equal(view.followsGlobal,true);
});

test("raw builtin credentials remain unmanaged with no inferred stored-slot identity or credit",()=>{
  const value=catalog("global");value.next.provider="github-copilot";
  const view=deriveSessionBadgeState(value);
  assert.equal(view.unmanaged,true);assert.equal(view.account,null);assert.equal(view.remaining,null);assert.equal(view.followsGlobal,false);
  assert.equal(view.canBind,true,"explicit repair into a healthy managed route remains possible");
});

test("inactive non-Copilot Session never shows global credits",()=>{
  const view=deriveSessionBadgeState(catalog("inactive"));
  assert.equal(view.account,null);assert.equal(view.remaining,null);assert.equal(view.canBind,false);assert.equal(view.canSetDefault,true);
});

test("missing/unavailable bound account and mismatched route fail closed",()=>{
  for(const change of [
    (value)=>{value.accounts=value.accounts.filter((row)=>row.id!==A);},
    (value)=>{value.next.available=false;},
    (value)=>{value.accounts[0].routeId=ROUTE_B;},
    (value)=>{value.next.accountId=null;},
  ]){
    const value=catalog();change(value);const view=deriveSessionBadgeState(value);
    assert.equal(view.account,null);assert.equal(view.remaining,null);assert.equal(view.unavailable,true);
    assert.equal(view.globalAccountId,B);
  }
});

test("explicit row availability blocks its credit without forcing a global fallback",()=>{
  const bound=catalog();bound.accounts[0].available=false;
  const view=deriveSessionBadgeState(bound);
  assert.equal(view.account,null);assert.equal(view.remaining,null);assert.equal(view.unavailable,true);
  assert.equal(view.canBind,true,"healthy replacement binding remains possible");
  const global=catalog("global");global.accounts[1].available=false;
  assert.equal(deriveSessionBadgeState(global).account,null);
  assert.equal(deriveSessionBadgeState(global).unavailable,true);
});

test("busy/running blocks session binding, but global default is a separate action",()=>{
  assert.equal(deriveSessionBadgeState(catalog(),{busy:true}).canBind,false);
  assert.equal(deriveSessionBadgeState(catalog(),{running:true}).canBind,false);
  const value=catalog();value.running=true;
  const running=deriveSessionBadgeState(value);
  assert.equal(running.canBind,false);assert.equal(running.canSetDefault,true);
});

test("ambiguous/missing global defaults and unavailable usage do not invent credit",()=>{
  const value=catalog("global");value.accounts[0].active=true;
  assert.equal(deriveSessionBadgeState(value).account,null);
  value.accounts=rows();value.accounts[1].usageError="unavailable";
  assert.equal(deriveSessionBadgeState(value).remaining,null);
  value.accounts[1].usageError=undefined;value.accounts[1].usage={unlimited:true};
  assert.equal(deriveSessionBadgeState(value).unlimited,true);
});

test("fixed error keys never interpolate arbitrary server messages",()=>{
  assert.equal(sessionBadgeErrorKey("OWNER_REQUIRED"),"badgeErrorOwner");
  assert.equal(sessionBadgeErrorKey("https://private.example/secret"),"badgeErrorRequest");
  assert.equal(sessionBadgeErrorKey("__proto__"),"badgeErrorRequest");
  assert.equal(sessionBadgeErrorKey("constructor"),"badgeErrorRequest");
});

test("native transport is resolved from the retained Session scope, never global fetch",async(t)=>{
  t.mock.method(globalThis,"fetch",async()=>assert.fail("badge must never use REST/global fetch"));
  const f=fixture();await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().status,"ready");assert.equal(f.calls[0].channel,"/api");
  assert.equal(f.calls[0].request.sessionId,"s");
  f.controller.dispose();
  assert.equal(f.generation.count(),0);assert.equal(f.sessionState.count(),0);assert.equal(f.projection.count(),0);assert.equal(f.list.count(),0);
});

test("bind sends complete expected selection; Set-global never invokes bind",async()=>{
  const f=fixture();f.setData(catalog("global"));await f.controller.refresh();
  assert.equal(await f.controller.bind(A),true);
  const bind=f.calls.find((call)=>call.method==="bind");
  assert.deepEqual(bind.request,{sessionId:"s",accountId:A,expected:{provider:"copilot-default",model:"gpt-5.4",reasoningEffort:"high"}});
  assert.equal(deriveSessionBadgeState(f.controller.getSnapshot().catalog).selectedAccountId,A);
  assert.equal(await f.controller.setDefault(A),true);
  assert.equal(f.calls.filter((call)=>call.method==="bind").length,1);
  assert.equal(deriveSessionBadgeState(f.controller.getSnapshot().catalog).selectedAccountId,A);
  assert.equal(deriveSessionBadgeState(f.controller.getSnapshot().catalog).globalAccountId,A);
  f.controller.dispose();
});

test("running and inactive states issue no bind mutation",async()=>{
  const f=fixture();await f.controller.refresh();
  f.sessionState.set({running:true});assert.equal(await f.controller.bind(B),false);
  f.sessionState.set({running:false});f.setData(catalog("inactive"));await f.controller.refresh();
  assert.equal(await f.controller.bind(B),false);assert.equal(f.calls.filter((call)=>call.method==="bind").length,0);
  f.controller.dispose();
});

test("unavailable row cannot be selected/defaulted but another healthy row repairs binding",async()=>{
  const f=fixture(),value=catalog();value.accounts[0].available=false;f.setData(value);
  await f.controller.refresh();
  assert.equal(await f.controller.bind(A),false);
  assert.equal(await f.controller.setDefault(A),false);
  assert.equal(f.calls.filter((call)=>call.method==="bind"||call.method==="setDefault").length,0);
  assert.equal(await f.controller.bind(B),true);
  assert.equal(deriveSessionBadgeState(f.controller.getSnapshot().catalog).selectedAccountId,B);
  f.controller.dispose();
});

test("alias-only profile failure blocks binding but not native global default or credits",async()=>{
  const f=fixture(),value=catalog();
  value.accounts[0].available=true;value.accounts[0].routeAvailable=false;value.next.available=false;f.setData(value);
  await f.controller.refresh();
  assert.equal(deriveSessionBadgeState(f.controller.getSnapshot().catalog).account,null);
  assert.equal(await f.controller.bind(A),false);
  assert.equal(await f.controller.setDefault(A),true);
  const global={...f.data(),next:{mode:"global",provider:"copilot-default",model:"gpt-5.4",accountId:null,available:true}};
  const view=deriveSessionBadgeState(global);
  assert.equal(view.account.id,A);assert.equal(view.remaining,80);
  assert.equal(f.calls.filter((call)=>call.method==="bind").length,0);
  f.controller.dispose();
});

test("failed mutation is never automatically retried and cached private state is cleared",async()=>{
  const f=fixture({call:(method)=>method==="bind"?{ok:false,error:{code:"STALE_SELECTION"}}:undefined});
  await f.controller.refresh();assert.equal(await f.controller.bind(B),false);
  const snapshot=f.controller.getSnapshot();
  assert.equal(snapshot.status,"unavailable");assert.equal(snapshot.errorCode,"STALE_SELECTION");assert.equal(snapshot.catalog,null);
  assert.equal(f.calls.filter((call)=>call.method==="bind").length,1);
  assert.equal(f.calls.filter((call)=>call.method==="catalog").length,1);
  f.controller.dispose();
});

test("old catalog cannot overwrite a newer model-selection refresh",async()=>{
  const old=deferred();let count=0;
  const f=fixture({call:(method)=>method==="catalog"&&++count===1?old.promise:undefined});
  const pending=f.controller.refresh();
  f.setData(catalog("global"));f.projection.set({next:{provider:"copilot-default",model:"gpt-5.4"}});
  assert.equal(f.controller.getSnapshot().catalog,null);
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().catalog.next.mode,"global");
  old.resolve({ok:true,value:catalog("bound")});await pending;
  assert.equal(f.controller.getSnapshot().catalog.next.mode,"global");
  f.controller.dispose();
});

test("Host generation switch clears data and ignores old-host responses",async()=>{
  const old=deferred();let first=true;
  const f=fixture({call:(method)=>method==="catalog"&&first?(first=false,old.promise):undefined});
  const pending=f.controller.refresh(),key=f.controller.getSnapshot().scopeKey;
  f.switchHost("B");await f.controller.refresh();
  assert.notEqual(f.controller.getSnapshot().scopeKey,key);
  old.resolve({ok:true,value:{...catalog(),accounts:[{id:A,domain:"OLD-HOST",login:"secret"}]}});await pending;
  assert.notEqual(f.controller.getSnapshot().catalog.accounts[0].domain,"OLD-HOST");
  f.controller.dispose();
});

test("same-id replacement binding gets a fresh client and scope",async()=>{
  const f=fixture();await f.controller.refresh();const key=f.controller.getSnapshot().scopeKey;
  f.replaceBinding();await f.controller.refresh();
  assert.notEqual(f.controller.getSnapshot().scopeKey,key);
  assert.equal(f.generation.count(),1);assert.equal(f.projection.count(),1);
  f.controller.dispose();
});

test("profile recovery dedupes only within one transport, never across Hosts",async()=>{
  const old=deferred();
  const f=fixture({call:(method,request,host)=>method==="profile"&&host==="A"?old.promise:undefined});
  await f.controller.refresh();
  const requestA=f.controller.getSnapshot().requestProfile;
  const pending=requestA(A);const same=requestA(A);
  assert.equal(pending,same);const settled=assert.rejects(pending,(error)=>error.code==="STALE_SESSION");
  f.switchHost("B");await f.controller.refresh();
  const fresh=f.controller.getSnapshot().requestProfile(A);
  assert.equal(await fresh,"https://B.ghe.com/fresh");
  old.resolve({ok:true,value:{ok:true,avatarUrl:"https://old-host/private-avatar"}});await settled;
  assert.deepEqual(f.calls.filter((call)=>call.method==="profile").map((call)=>call.host),["A","B"]);
  f.controller.dispose();
});

const failureNotice=(id="11111111-1111-4111-8111-111111111111",extra={})=>({id,sessionId:"s",code:"ACCOUNT_REQUEST_FAILED",accountId:A,logicalProvider:ROUTE_A,model:"gpt-5.4",...extra});

test("only a new matching native error notice opens a popup; historic reads and duplicates do not",async()=>{
  const f=fixture(),old=failureNotice();f.setData({...catalog(),notice:old});await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().failureNotice,null);
  f.emitError();await f.controller.refresh();assert.equal(f.controller.getSnapshot().failureNotice,null);
  const fresh=failureNotice("22222222-2222-4222-8222-222222222222");f.setData({...catalog(),notice:fresh});
  f.emitError("s","FAKE_PRIVATE_ERROR_TEXT");await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().failureNotice.id,fresh.id);
  assert.equal(JSON.stringify(f.controller.getSnapshot().failureNotice).includes("FAKE_PRIVATE"),false);
  f.controller.dismissFailure();f.emitError();await f.controller.refresh();assert.equal(f.controller.getSnapshot().failureNotice,null);
  assert.ok(f.calls.every((call)=>call.method==="catalog"));f.controller.dispose();assert.equal(f.errorListeners.size,0);
});

test("foreign Session/account and retired Host error events never open a popup",async()=>{
  const f=fixture();await f.controller.refresh();const oldListener=[...f.errorListeners][0],before=f.calls.length;
  f.emitError("other-session");assert.equal(f.calls.length,before);
  f.setData({...catalog(),notice:failureNotice(undefined,{accountId:B,logicalProvider:ROUTE_B})});f.emitError();await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().failureNotice,null);
  f.switchHost("B");await f.controller.refresh();
  f.setData({...catalog(),notice:failureNotice("33333333-3333-4333-8333-333333333333")});
  oldListener("s","FAKE_OLD_HOST_ERROR");await f.controller.refresh();assert.equal(f.controller.getSnapshot().failureNotice,null);
  f.controller.dispose();
});

test("loss of authorized current catalog closes a previously matched popup",async()=>{
  let deny=false;const f=fixture({call(method){if(method==="catalog"&&deny)return Promise.reject(Object.assign(new Error("FAKE_PRIVATE_DENIAL"),{code:"OWNER_REQUIRED"}));}});
  await f.controller.refresh();f.setData({...catalog(),notice:failureNotice()});f.emitError();await f.controller.refresh();
  assert.ok(f.controller.getSnapshot().failureNotice);deny=true;await f.controller.refresh(true);
  assert.equal(f.controller.getSnapshot().catalog,null);assert.equal(f.controller.getSnapshot().failureNotice,null);
  f.controller.dispose();
});

test("selection invalidation cancels an outstanding failure popup read",async()=>{
  let hold=false;const delayed=deferred();const f=fixture({call(method){if(method==="catalog"&&hold){hold=false;return delayed.promise;}}});
  await f.controller.refresh();hold=true;f.emitError();const pending=f.controller.refresh();
  f.setData(catalog("global"));f.projection.set({});await f.controller.refresh();
  delayed.resolve({ok:true,value:{...catalog(),notice:failureNotice()}});await pending;
  assert.equal(f.controller.getSnapshot().failureNotice,null);f.controller.dispose();
});

test("trusted catalog removal/issuer change and Host retirement synchronously clear pooled images",async()=>{
  const removed=[],retired=[],imageCache={invalidateAccount:(scope,issuer,id)=>removed.push({scope,issuer,id}),disposeScope:(scope)=>retired.push(scope)};
  const f=fixture({imageCache});await f.controller.refresh();const scope=f.controller.getSnapshot().scopeKey;
  const next=catalog();next.accounts=next.accounts.filter((row)=>row.id!==B).map((row)=>({...row,domain:"changed.ghe.com"}));f.setData(next);await f.controller.refresh(true);
  assert.deepEqual(removed,[{scope,issuer:"a.ghe.com",id:A},{scope,issuer:"b.ghe.com",id:B}]);
  f.switchHost("B");assert.equal(retired[0],scope);await f.controller.refresh();const current=f.controller.getSnapshot().scopeKey;
  assert.notEqual(current,scope);f.controller.dispose();assert.equal(retired.at(-1),current);
});

test("StrictMode-like dispose/recreate never reuses a disposed native client",async()=>{
  const f=fixture();await f.controller.refresh();f.controller.dispose();
  const second=createSessionBadgeController({sessionId:"s",sessions:f.sessions});await second.refresh();
  assert.equal(second.getSnapshot().status,"ready");
  assert.equal(await second.bind(B),true);
  second.dispose();assert.equal(f.generation.count(),0);
});
