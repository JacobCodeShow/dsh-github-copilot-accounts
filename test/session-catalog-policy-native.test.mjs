// Optional real published LlmRuntime API forwarding; no application, profile,
// credentials or provider HTTP. Adapters emit only synthetic in-memory chunks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createSessionLlmCatalogPolicy } from "../src/session-catalog-policy.mjs";
import { GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
const modules=new URL("../../dsh-session-account-review/installed/dsh/node_modules/@deepseek-ai/",import.meta.url);
const present=existsSync(new URL("cordis/lib/index.js",modules))&&existsSync(new URL("dsh-llm/lib/index.js",modules));
test("real root LlmRuntime remains untouched while private catalog tracks managed registration and forwards streams",{skip:present?false:"optional extracted LlmRuntime fixture absent"},async(t)=>{
  const previous=globalThis.fetch;globalThis.fetch=async()=>assert.fail("Network forbidden in catalog test");t.after(()=>{globalThis.fetch=previous;});
  const [{Context},{LlmRuntime,LlmAdapter}]=await Promise.all([import(new URL("cordis/lib/index.js",modules).href),import(new URL("dsh-llm/lib/index.js",modules).href)]);
  const root=new Context();new LlmRuntime(root);t.after(()=>root.fiber.dispose());
  const llm=root.get("llm"),received=[];let managedModels=[{id:"model",name:"Model"}];
  class Adapter extends LlmAdapter{
    providerInfo(provider){return{id:provider,name:provider};}
    async listModels(provider){return provider===GLOBAL_COPILOT_ROUTE?managedModels.map((model)=>({...model,provider})):[{provider,id:"model",name:"Model"}];}
    async resolveModel(provider,model){return{provider,id:model,name:"Model",inputModalities:["text"],context:{contextWindow:32000}};}
    async *stream(options){received.push(options);yield{type:"block-start",index:0,blockType:"text"};yield{type:"text-delta",index:0,text:"synthetic"};yield{type:"block-end",index:0,block:{type:"text",text:"synthetic"}};yield{type:"finish",reason:{kind:"stop"}};}
  }
  llm.registerAdapter(["github-copilot","other-provider"],new Adapter());
  const ready=()=>llm.listProviders().some((row)=>row.id===GLOBAL_COPILOT_ROUTE);
  const privateLlm=createSessionLlmCatalogPolicy(llm,{isManagedReady:ready});
  assert.ok(privateLlm.listProviders().some((row)=>row.id==="github-copilot"));
  const managed=llm.registerAdapter([GLOBAL_COPILOT_ROUTE],new Adapter());
  assert.equal(privateLlm.listProviders().some((row)=>row.id==="github-copilot"),false);
  assert.equal(llm.listProviders().some((row)=>row.id==="github-copilot"),true);
  assert.deepEqual(await privateLlm.listModels("github-copilot"),[]);
  assert.equal((await llm.listModels("github-copilot"))[0].id,"model");
  managedModels=[];
  assert.deepEqual(await privateLlm.listModels(GLOBAL_COPILOT_ROUTE),[]);
  assert.equal(privateLlm.listProviders().some((row)=>row.id==="github-copilot"),false,"NoDefault must not expose builtin bypass");
  const request=Object.freeze({provider:"other-provider",model:"model",messages:Object.freeze([{role:"user",content:[{type:"text",text:"safe"}]}])});
  const chunks=[];for await(const chunk of privateLlm.stream(request))chunks.push(chunk);
  assert.equal(chunks.at(-1).reason.kind,"stop");assert.equal(received[0],request);
  const prepared=await privateLlm.prepareCall({provider:"other-provider",model:"model"});assert.equal(prepared.config.provider,"other-provider");
  managed();assert.equal(privateLlm.listProviders().some((row)=>row.id==="github-copilot"),true);
  for(const key of ["adapters","directory","discoveries","registration","typertRemote","ctx"])assert.equal(privateLlm[key],undefined);
});
