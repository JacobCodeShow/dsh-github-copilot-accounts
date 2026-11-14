import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountRefreshHttp as createHttp, parseAccountModelIds } from "../src/account-refresh-http.mjs";
const createAccountRefreshHttp = (options = {}) => createHttp({
  deriveAuth: async (grant) => ({ baseUrl: grant.enterpriseUrl ? `https://copilot-api.${grant.enterpriseUrl}` : "https://api.individual.githubcopilot.com", apiKey: "DO_NOT_USE_RESOLVER_OVERRIDE" }),
  ...options,
});
const payload = (domain) => ({ type: "oauth", refresh: "FAKE_REFRESH_NOT_REAL", access: "FAKE_OLD_NOT_REAL", expires: 0,
  ...(domain === "github.com" ? {} : { enterpriseUrl: domain }), account: { domain } });
const token = { token: "FAKE_NEW_NOT_REAL", expires_at: 2_000_000_000, refresh_in: 1500 };
const models = { data: [{ id: "model-a", model_picker_enabled: true, policy: { state: "enabled" } }] };

test("account refresh uses matching GitHub API and native-derived model endpoint without redirects", async () => {
  const calls = [];
  const refresh = createAccountRefreshHttp({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith("/models") ? models : token };
  } });
  for (const domain of ["github.com", "company-a.ghe.com"]) {
    const signal = new AbortController().signal;
    const result = await refresh({ payload: payload(domain), domain, signal });
    const call = calls.at(-2), catalog = calls.at(-1);
    assert.equal(call.url, `https://api.${domain}/copilot_internal/v2/token`);
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.signal, signal);
    assert.equal(call.options.headers.get("authorization"), "Bearer FAKE_REFRESH_NOT_REAL");
    assert.equal(call.options.headers.get("copilot-integration-id"), "vscode-chat");
    assert.equal(catalog.url, domain === "github.com" ? "https://api.individual.githubcopilot.com/models" : `https://copilot-api.${domain}/models`);
    assert.equal(catalog.options.headers.get("authorization"), "Bearer FAKE_NEW_NOT_REAL", "never use another resolver auth override");
    assert.equal(catalog.options.redirect, "error");
    assert.equal(catalog.options.signal, signal);
    assert.equal(catalog.options.headers.get("x-github-api-version"), "2026-06-01");
    assert.deepEqual(result, { access: "FAKE_NEW_NOT_REAL", expires: 2_000_000_000_000 - 300000, refreshIn: 1500, availableModelIds: ["model-a"] });
  }
});

test("refresh callback refuses mismatched domains and non-Cloud/custom URL targets before HTTP", async () => {
  let requests = 0;
  const refresh = createAccountRefreshHttp({ fetchImpl: async () => { requests++; throw new Error("must not run"); } });
  for (const domain of ["github.com.evil.invalid", "https://company-a.ghe.com/avatars/u/1", "company-b.ghe.com", "company-a.ghe.com:443", "other.invalid", "company-a.ghe.com@other.invalid"]) {
    await assert.rejects(refresh({ payload: payload("company-a.ghe.com"), domain }), (error) => error.code === "ACCOUNT_REFRESH_HTTP");
  }
  await assert.rejects(refresh({ payload: { type: "api_key", refresh: "FAKE" }, domain: "github.com" }));
  assert.equal(requests, 0);
  assert.throws(() => createHttp(), /integration is unavailable/);
});

test("credential header exceptions, network failures and refusal bodies never reach diagnostics", async () => {
  const marker = "PRIVATE_DIAGNOSTIC_MUST_NOT_ESCAPE";
  let requests = 0;
  const badHeader = createAccountRefreshHttp({ fetchImpl: async () => { requests++; } });
  await assert.rejects(badHeader({ payload: { ...payload("github.com"), refresh: marker + "\n" }, domain: "github.com" }), (error) => !error.message.includes(marker) && !error.cause);
  assert.equal(requests, 0);
  const failed = createAccountRefreshHttp({ fetchImpl: async () => { throw new Error(marker); } });
  await assert.rejects(failed({ payload: payload("github.com"), domain: "github.com" }), (error) => !error.message.includes(marker) && !error.cause);
  const refused = createAccountRefreshHttp({ fetchImpl: async () => ({ ok: false, status: 401, json() { throw new Error(marker); } }) });
  await assert.rejects(refused({ payload: payload("github.com"), domain: "github.com" }), (error) => error.status === 401 && !error.message.includes(marker) && !error.cause);
});

test("malformed token JSON and incomplete response are rejected with safe static errors", async () => {
  for (const json of [async () => { throw new Error("PRIVATE_BODY"); }, async () => ({}), async () => ({ token: "FAKE", expires_at: Infinity }), async () => ({ token: "FAKE", expires_at: 1e307 }), async () => ({ token: "FAKE\n", expires_at: 2_000_000_000 }), async () => ({ token: "", expires_at: 2_000_000_000 }), async () => ({ token: "FAKE", expires_at: 2_000_000_000, refresh_in: NaN })]) {
    const refresh = createAccountRefreshHttp({ fetchImpl: async () => ({ ok: true, json }) });
    await assert.rejects(refresh({ payload: payload("github.com"), domain: "github.com" }), (error) => error.code === "ACCOUNT_REFRESH_HTTP" && !error.message.includes("PRIVATE") && !error.cause);
  }
});

test("native endpoint derivation cannot send fresh credentials to arbitrary or credential-bearing URLs", async () => {
  for (const baseUrl of ["http://api.individual.githubcopilot.com", "https://evil.invalid", "https://api.individual.githubcopilot.com:444", "https://copilot-api.company-b.ghe.com", "https://api.individual.githubcopilot.com/custom", "https://user:FAKE@api.individual.githubcopilot.com", "https://api.individual.githubcopilot.com?token=FAKE"]) {
    const calls = [];
    const refresh = createAccountRefreshHttp({ deriveAuth: async () => ({ baseUrl }), fetchImpl: async (url) => { calls.push(url); return { ok: true, json: async () => token }; } });
    await assert.rejects(refresh({ payload: payload("company-a.ghe.com"), domain: "company-a.ghe.com" }), (error) => error.code === "ACCOUNT_REFRESH_HTTP" && !error.message.includes("FAKE"));
    assert.deepEqual(calls, ["https://api.company-a.ghe.com/copilot_internal/v2/token"]);
  }
});

test("available model policy follows native picker/tool/disabled rules and Individual-only fallback", () => {
  const raw = { data: [null, {}, { id: "a", model_picker_enabled: true }, { id: "a", model_picker_enabled: true },
    { id: "disabled", model_picker_enabled: true, policy: { state: "disabled" } },
    { id: "no-tools", model_picker_enabled: true, capabilities: { supports: { tool_calls: false } } },
    { id: "policy-only", model_picker_enabled: false, policy: { state: "enabled" } }] };
  assert.deepEqual(parseAccountModelIds(raw, true), ["a"]);
  assert.deepEqual(parseAccountModelIds(raw, false), ["a"]);
  const fallback = { data: [{ id: "enabled", policy: { state: "enabled" } }, { id: "not-enabled", policy: { state: "unconfigured" } }] };
  assert.deepEqual(parseAccountModelIds(fallback, true), ["enabled"]);
  assert.deepEqual(parseAccountModelIds(fallback, false), []);
  assert.deepEqual(parseAccountModelIds({ data: [] }), []);
  assert.throws(() => parseAccountModelIds({ data: "invalid" }), /Invalid Copilot/);
});

test("model-catalog failure is not silently treated as a successful token-only refresh", async () => {
  const refresh = createAccountRefreshHttp({ fetchImpl: async (url) => url.endsWith("/models")
    ? { ok: false, status: 403, json() { assert.fail("do not print/reforward refusal body"); } }
    : { ok: true, json: async () => token } });
  await assert.rejects(refresh({ payload: payload("github.com"), domain: "github.com" }), (error) => error.status === 403);
});
