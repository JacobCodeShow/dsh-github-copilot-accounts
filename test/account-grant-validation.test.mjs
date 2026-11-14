import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountCredentialStore } from "../src/account-adapter.mjs";

const id = "copilot-auth/account-validation";
const original = () => ({ kind: "grant", payload: { type: "oauth", refresh: "FAKE_REFRESH_NOT_REAL", access: "FAKE_ACCESS_NOT_REAL", expires: 0, account: { domain: "github.com", name: "Retain" } } });
function fixture(record = original()) {
  const records = new Map([[id, structuredClone(record)]]);
  const credentials = {
    async readRecord(key) { assert.equal(key, id); return structuredClone(records.get(key)); },
    async modifyRecord(key, mutate) { assert.equal(key, id); const next = await mutate(structuredClone(records.get(key))); if (next !== undefined) records.set(key, next); return structuredClone(records.get(key)); },
  };
  return { records, store: createAccountCredentialStore({ credentials, accountId: id }) };
}

test("corrupt OAuth payloads fail before native SDK can attempt header or environment fallback", async () => {
  for (const change of [
    { refresh: undefined }, { refresh: "" }, { refresh: "PRIVATE\nVALUE" }, { access: undefined }, { access: "" },
    { access: "PRIVATE\nVALUE" }, { access: "FAKE🙂" }, { expires: undefined }, { expires: NaN }, { expires: Infinity },
  ]) {
    const record = original(); Object.assign(record.payload, change);
    const { store } = fixture(record);
    await assert.rejects(store.read("github-copilot"), (error) => error.code === "ACCOUNT_UNAVAILABLE" && !error.message.includes("PRIVATE") && !error.cause);
  }
});

test("a GHE-labelled grant without native enterprise identity cannot silently route to public GitHub", async () => {
  const record = original(); record.payload.account.domain = "company-a.ghe.com";
  await assert.rejects(fixture(record).store.read("github-copilot"), { code: "ACCOUNT_UNAVAILABLE" });
  record.payload.enterpriseUrl = "https://company-a.ghe.com/";
  assert.equal((await fixture(record).store.read("github-copilot")).enterpriseUrl, record.payload.enterpriseUrl);
  record.payload.enterpriseUrl = "not a valid host!";
  await assert.rejects(fixture(record).store.read("github-copilot"), { code: "ACCOUNT_UNAVAILABLE" });
});

test("invalid native refresh result is rejected BEFORE persistence and retains working grant", async () => {
  for (const change of [{ access: undefined }, { access: "PRIVATE\nVALUE" }, { refresh: "" }, { expires: NaN }]) {
    const { records, store } = fixture();
    const before = structuredClone(records.get(id));
    await assert.rejects(store.modify("github-copilot", async (previous) => ({ ...previous, ...change })), { code: "INVALID_ACCOUNT_GRANT" });
    assert.deepEqual(records.get(id), before);
  }
});
