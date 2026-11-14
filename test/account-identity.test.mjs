import { test } from "node:test";
import assert from "node:assert/strict";
import { accountCredentialIdentity, isAccountCredentialIdentity } from "../src/account-identity.mjs";
const grant={type:"oauth",enterpriseUrl:"https://TENANT.ghe.com/path",refresh:"FAKE_LONG_GRANT",access:"FAKE_SHORT_ONE"};
test("identity binds normalized native issuer and long grant but never short access",()=>{
  const first=accountCredentialIdentity(grant);
  assert.ok(isAccountCredentialIdentity(first));assert.equal(first.includes("FAKE_"),false);
  assert.equal(accountCredentialIdentity({...grant,enterpriseUrl:"tenant.ghe.com",access:"FAKE_SHORT_TWO"}),first);
  assert.notEqual(accountCredentialIdentity({...grant,refresh:"FAKE_OTHER_LONG"}),first);
  assert.notEqual(accountCredentialIdentity({...grant,enterpriseUrl:"other.ghe.com"}),first);
});
test("native default issuer ignores display-only account domain and failures are static",()=>{
  const value={type:"oauth",refresh:"FAKE_LONG_GRANT"};
  assert.equal(accountCredentialIdentity({...value,enterpriseUrl:null}),accountCredentialIdentity(value));
  assert.equal(accountCredentialIdentity({...value,account:{domain:"display.ghe.com"}}),accountCredentialIdentity({...value,enterpriseUrl:"github.com"}));
  assert.throws(()=>accountCredentialIdentity({...value,enterpriseUrl:"https://%INVALID"}),(error)=>error.message==="Copilot credential identity is unavailable");
  assert.throws(()=>accountCredentialIdentity({type:"api_key",key:"FAKE_SECRET"}),(error)=>!error.message.includes("FAKE_SECRET"));
});
