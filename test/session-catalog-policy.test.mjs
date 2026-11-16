import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionLlmCatalogPolicy, SESSION_LLM_PUBLIC_METHODS } from "../src/session-catalog-policy.mjs";
import { GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
function fixture(){
  const calls=[],result=new Map();let ready=false;
  const backing={adapters:new Map(),directory:new Map(),ctx:{private:true},typertRemote:{private:true},registration(){throw new Error("must not copy private helper");}};
  for(const name of SESSION_LLM_PUBLIC_METHODS)backing[name]=function(...args){assert.equal(this,backing);calls.push({name,args});return result.get(name);};
  const providers=Object.freeze([{id:"github-copilot",name:"Builtin"},{id:GLOBAL_COPILOT_ROUTE,name:"Managed"},{id:"other",name:"Other"}]);
  result.set("listProviders",providers);result.set("listModels",Promise.resolve([{id:"model"}]));
  const facade=createSessionLlmCatalogPolicy(backing,{isManagedReady:()=>ready});
  return{backing,facade,calls,result,providers,setReady:(value)=>{ready=value;}};
}

test("private catalog hides only builtin when managed engine is ready",async()=>{
  const f=fixture();assert.equal(f.facade.listProviders(),f.providers);
  assert.equal(f.facade.listModels("github-copilot"),f.result.get("listModels"));
  f.setReady(true);
  assert.deepEqual(f.facade.listProviders().map((row)=>row.id),[GLOBAL_COPILOT_ROUTE,"other"]);
  assert.deepEqual(await f.facade.listModels("github-copilot"),[]);
  assert.equal(f.calls.filter((call)=>call.name==="listModels").length,1);
  assert.equal(f.facade.listModels(GLOBAL_COPILOT_ROUTE),f.result.get("listModels"));
  assert.equal(f.providers[0].id,"github-copilot");
  f.setReady(false);assert.equal(f.facade.listProviders(),f.providers);
});

test("NoDefault does not unhide builtin while engine readiness remains true",async()=>{
  const f=fixture();f.setReady(true);f.result.set("listModels",Promise.resolve([]));
  assert.deepEqual(await f.facade.listModels(GLOBAL_COPILOT_ROUTE),[]);
  assert.equal(f.facade.listProviders().some((row)=>row.id==="github-copilot"),false);
  assert.deepEqual(await f.facade.listModels("github-copilot"),[]);
});

test("all other published methods preserve exact arguments receiver and returned objects",()=>{
  const f=fixture(),options=Object.freeze({provider:"other",model:"m",messages:Object.freeze([])}),signal=new AbortController().signal;
  for(const method of SESSION_LLM_PUBLIC_METHODS.filter((name)=>!["listProviders","listModels"].includes(name))){
    const value={method};f.result.set(method,value);
    assert.equal(f.facade[method](options,signal),value);
    assert.equal(f.calls.at(-1).args[0],options);assert.equal(f.calls.at(-1).args[1],signal);
  }
  assert.equal(options.provider,"other");assert.ok(Object.isFrozen(f.facade));
});

test("facade never exposes private runtime maps helpers trackers or remote bindings",()=>{
  const f=fixture();
  for(const key of ["adapters","directory","discoveries","ctx","registration","typertRemote"])assert.equal(f.facade[key],undefined);
  assert.deepEqual(Object.keys(f.facade).sort(),[...SESSION_LLM_PUBLIC_METHODS].sort());
  assert.deepEqual(Object.getOwnPropertySymbols(f.facade),[]);
});

test("missing public runtime capability fails before exposing a partial facade",()=>{
  const f=fixture();delete f.backing.prepareCall;
  assert.throws(()=>createSessionLlmCatalogPolicy(f.backing),/Unsupported Session LLM catalog interface/);
});
