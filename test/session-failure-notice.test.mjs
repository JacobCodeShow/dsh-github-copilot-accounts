import { test } from "node:test";
import assert from "node:assert/strict";
import { publicSessionFailureNotice } from "../src/session-remote.mjs";
import { accountRouteId, GLOBAL_COPILOT_ROUTE } from "../src/account-route-id.mjs";
const A="copilot-auth/account-a",B="copilot-auth/account-b";
const notice=()=>({id:"11111111-1111-4111-8111-111111111111",sessionId:"s",code:"ACCOUNT_REQUEST_FAILED",accountId:A,logicalProvider:accountRouteId(A),model:"m",turn:2,step:1});
test("notice DTO exposes fixed identifiers but no diagnostic/grant fields",()=>{
  const value=notice(),dto=publicSessionFailureNotice({...value,message:"FAKE_PRIVATE_URL",failure:{access:"FAKE_SECRET"},payload:{refresh:"FAKE_LONG"}},"s");
  assert.deepEqual(dto,value);assert.equal(JSON.stringify(dto).includes("FAKE_"),false);
  assert.equal(publicSessionFailureNotice({...value,logicalProvider:GLOBAL_COPILOT_ROUTE},"s").accountId,A);
});
test("invalid notice session, code, id or route/account contradiction is omitted",()=>{
  for(const change of [{sessionId:"other"},{code:"RAW_PROVIDER_ERROR"},{id:"https://private.invalid/FAKE_SECRET"},{accountId:"github-copilot"},{logicalProvider:accountRouteId(B)},{logicalProvider:"github-copilot"}])assert.equal(publicSessionFailureNotice({...notice(),...change},"s"),null);
  assert.equal(publicSessionFailureNotice(undefined,"s"),null);
});
