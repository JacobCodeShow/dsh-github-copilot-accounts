import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionRemoteService, SESSION_ACCOUNTS_NAMESPACE } from "../src/session-remote.mjs";

const ID = "copilot-auth/account-a";
const fail = (code, message = "private details must stay private") => Object.assign(new Error(message), { code, status: 418 });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
class RemoteFailure extends Error { constructor(code, message, details) { super(message); Object.assign(this, { code, details, isDSHRemoteError: true }); } }
class RemoteBase { constructor(ctx, key, options) { this.ctx = ctx; this.binding = { key, ...options }; } }
function Remote(options) { return (_, context) => context.addInitializer(function() { (this.markers ??= []).push({ method: context.name, options }); }); }
const selection = { provider: "github-copilot", model: "gpt-5.4", reasoningEffort: "high" };
const route = { ...selection, mode: "global", accountId: null, available: true };
const state = (sessionId) => ({ sessionId, running: false, next: { ...route }, lastUsed: { ...route } });
function context(kind = "owner", allowed = true, tag = "call") {
  const ctx = { invocation: kind === undefined ? undefined : { peer: { principal: { kind } }, signal: new AbortController().signal }, tag };
  ctx.remoteAccess = { allows(resource) { ctx.seenResource = resource; return typeof allowed === "function" ? allowed(resource) : allowed; } };
  return ctx;
}
function fixture(overrides = {}) {
  const calls = [], handlers = [], ownerContext = context("owner", true, "constructor-owner");
  let creates = 0;
  const Coordinator = createSessionRemoteService({
    TypertRemoteService: RemoteBase, Remote, RemoteError: RemoteFailure,
    principalOf: (invocation) => invocation?.peer?.principal?.kind === "owner" ? undefined : invocation?.peer?.principal,
    createCoordinator(authorize) {
      creates++;
      return {
        async read(request) {
          calls.push({ operation: "read", sessionId: request.sessionId });
          if (!await authorize(request.sessionId, "read")) throw fail("SESSION_FORBIDDEN");
          if (overrides.read) return overrides.read(request, authorize);
          if (request.sessionId === "subagent") throw fail("SESSION_UNAVAILABLE");
          return state(request.sessionId);
        },
        async bind(request) {
          calls.push({ operation: "bind", sessionId: request.sessionId });
          if (!await authorize(request.sessionId, "write")) throw fail("SESSION_FORBIDDEN");
          if (overrides.bind) return overrides.bind(request, authorize);
          return { accepted: selection, ...state(request.sessionId) };
        },
      };
    },
    handlers: {
      async catalog(request, ctx) { handlers.push({ operation: "catalog", request, tag: ctx.tag }); return overrides.catalog ? overrides.catalog(request, ctx) : [{ id: ID, login: "alice", domain: "company-a.ghe.com", active: true }]; },
      async profile(request, ctx) { handlers.push({ operation: "profile", request, tag: ctx.tag }); return overrides.profile ? overrides.profile(request, ctx) : { ok: true, avatarUrl: "https://company-a.ghe.com/avatar.jpg?fixture=opaque" }; },
      async setDefault(request, ctx) { handlers.push({ operation: "setDefault", request, tag: ctx.tag }); return overrides.setDefault ? overrides.setDefault(request, ctx) : { ok: true, defaultAccountId: ID }; },
    },
  });
  const service = new Coordinator(ownerContext);
  const invoke = (method, request, ctx = context()) => service[method].call(Object.assign(Object.create(service), { ctx }), request);
  return { service, invoke, calls, handlers, creates: () => creates, ownerContext };
}
const rejected = async (promise, code, status) => assert.rejects(promise, (error) => error instanceof RemoteFailure && error.code === code && error.details.status === status && !error.message.includes("private details"));

test("manual Remote markers expose only four native methods and session resources", () => {
  const f = fixture();
  assert.equal(SESSION_ACCOUNTS_NAMESPACE, "copilotAccounts");
  assert.deepEqual(f.service.binding, { key: "copilotAccounts", namespace: "copilotAccounts" });
  assert.equal(f.creates(), 1);
  assert.deepEqual(f.service.markers.map((m) => m.method), ["catalog", "bind", "profile", "setDefault"]);
  for (const marker of f.service.markers) assert.equal(marker.options.resources.session({ sessionId: "s" }), "s");
});

test("owner catalog returns state and whitelist DTOs without grant fields or unsafe diagnostics", async () => {
  const opaqueUrl = "https://company-a.ghe.com/avatars/u/42?fixture=opaque";
  const f = fixture({ catalog: () => ({ signingIn: false, accounts: [{ id: ID, routeId: "alias", domain: "company-a.ghe.com", login: "alice", name: "Alice", avatarUrl: opaqueUrl, globalActive: true, plan: "Business", refresh: "FAKE_SECRET", access: "FAKE_SECRET", payload: { credential: "FAKE_SECRET" }, usageError: "FAKE_SECRET_URL", usage: { remaining: 5, entitlement: 10, percentUsed: 50, resets: "2026-12-01", extra: "FAKE_SECRET", invalid: NaN } }] }) });
  const ctx = context("owner", true, "remote-host-owner");
  const result = await f.invoke("catalog", { sessionId: "s" }, ctx);
  assert.equal(result.sessionId, "s");
  assert.equal(result.accounts[0].avatarUrl, opaqueUrl);
  assert.equal(result.accounts[0].usageError, "Usage is unavailable");
  assert.equal(result.signingIn, false);
  assert.equal(JSON.stringify(result).includes("FAKE_SECRET"), false);
  assert.deepEqual(ctx.seenResource, { kind: "session", id: "s" });
  assert.equal(f.handlers[0].tag, "remote-host-owner");
  assert.notEqual(f.handlers[0].tag, f.ownerContext.tag);
});

test("all methods deny non-owner even if session access policy allows reading", async () => {
  const f = fixture();
  for (const kind of ["share-viewer", "guest", "other"]) for (const method of ["catalog", "bind", "profile", "setDefault"]) {
    await rejected(f.invoke(method, { sessionId: "s", accountId: ID }, context(kind, true)), "OWNER_REQUIRED", 403);
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.handlers, []);
});

test("outside Remote invocation is not implicitly trusted owner", async () => {
  const f = fixture();
  const ctx = context();
  ctx.invocation = undefined;
  for (const method of ["catalog", "bind", "profile", "setDefault"]) await rejected(f.invoke(method, { sessionId: "s", accountId: ID }, ctx), "OWNER_REQUIRED", 403);
  assert.deepEqual(f.calls, []);
});

test("owner still needs actual per-invocation Session authorization", async () => {
  const f = fixture();
  await rejected(f.invoke("catalog", { sessionId: "s" }, context("owner", false)), "SESSION_FORBIDDEN", 403);
  await rejected(f.invoke("bind", { sessionId: "s", accountId: ID }, context("owner", false)), "SESSION_FORBIDDEN", 403);
  assert.deepEqual(f.handlers, []);
});

test("shared coordinator keeps per-call ALS principal/context separate across awaits", async () => {
  const enter = deferred(), release = deferred();
  const f = fixture({ read: async (request, authorize) => {
    if (request.sessionId === "a") { enter.resolve(); await release.promise; assert.equal(await authorize("a", "read"), true); }
    return state(request.sessionId);
  } });
  const a = f.invoke("catalog", { sessionId: "a" }, context("owner", (resource) => resource.id === "a", "A"));
  await enter.promise;
  await rejected(f.invoke("catalog", { sessionId: "b" }, context("owner", false, "B")), "SESSION_FORBIDDEN", 403);
  release.resolve();
  assert.equal((await a).sessionId, "a");
  assert.equal(f.creates(), 1);
  assert.deepEqual(f.handlers.map((call) => call.tag), ["A"]);
});

test("authorization callback rechecks changed policy while shared bind is queued", async () => {
  const enter = deferred(), release = deferred();
  let allowed = true, mutates = 0;
  const f = fixture({ bind: async (request, authorize) => {
    enter.resolve(); await release.promise;
    if (!await authorize(request.sessionId, "write")) throw fail("SESSION_FORBIDDEN");
    mutates++; return { accepted: selection, ...state(request.sessionId) };
  } });
  const pending = f.invoke("bind", { sessionId: "s", accountId: ID }, context("owner", () => allowed));
  await enter.promise;
  allowed = false; release.resolve();
  await rejected(pending, "SESSION_FORBIDDEN", 403);
  assert.equal(mutates, 0);
});

test("profile and default actions validate an ordinary Session before handlers", async () => {
  const f = fixture();
  for (const method of ["profile", "setDefault"]) await rejected(f.invoke(method, { sessionId: "subagent", accountId: ID }), "SESSION_UNAVAILABLE", 404);
  assert.deepEqual(f.handlers, []);
  const profile = await f.invoke("profile", { sessionId: "s", accountId: ID });
  assert.deepEqual(profile, { ok: true, avatarUrl: "https://company-a.ghe.com/avatar.jpg?fixture=opaque" });
  assert.deepEqual(await f.invoke("setDefault", { sessionId: "s", accountId: ID }), { ok: true, defaultAccountId: ID });
});

test("invalid requests or mutable credential-like ids fail before callbacks", async () => {
  const f = fixture();
  for (const value of [undefined, null, [], {}, {sessionId:""}, {sessionId:42}]) await rejected(f.invoke("catalog", value), "INVALID_ARGUMENT", 400);
  for (const id of [undefined, null, "", "llm-pi-ai/github-copilot", "https://outside.example/image", "copilot-auth/account-UPPER"]) for (const method of ["profile", "setDefault"]) {
    await rejected(f.invoke(method, { sessionId: "s", accountId: id }), "INVALID_ARGUMENT", 400);
  }
  await rejected(f.invoke("bind", {sessionId:"s",accountId:ID,expected:{provider:"github-copilot"}}), "INVALID_ARGUMENT",400);
  assert.deepEqual(f.handlers, []);
  assert.deepEqual((await f.invoke("bind", {sessionId:"s",accountId:null})).accepted, selection);
});

test("known coordinator failures retain only fixed code/message/status", async () => {
  for (const [code,status] of [["SESSION_BUSY",409],["POLICY_UNAVAILABLE",503],["ACCOUNT_UNAVAILABLE",404],["STALE_SELECTION",409],["session/writer-held",409]]) {
    const f = fixture({bind:()=>{throw fail(code,"https://private.example/FAKE_SECRET");}});
    await assert.rejects(f.invoke("bind",{sessionId:"s",accountId:ID}), (error)=>error.details.status===status && !error.message.includes("private.example") && !error.message.includes("FAKE_SECRET"));
  }
});

test("unknown handler errors or malformed coordinator state never expose raw response text", async () => {
  const f = fixture({profile:()=>{throw Object.assign(new Error("https://private.example/FAKE_SECRET"),{status:401,code:"unknown-secret-code"});}});
  await rejected(f.invoke("profile",{sessionId:"s",accountId:ID}),"INTERNAL_ERROR",500);
  const hostile = fixture({read:()=>({sessionId:"other-host-session",running:false,next:route,lastUsed:route})});
  await rejected(hostile.invoke("catalog",{sessionId:"s"}),"INTERNAL_ERROR",500);
});

test("declined handlers return fixed failures and output whitelists remain JSON-safe", async () => {
  const declined = fixture({profile:()=>({ok:false,error:"FAKE_SECRET"}),setDefault:()=>({ok:false,error:"FAKE_SECRET"})});
  await rejected(declined.invoke("profile",{sessionId:"s",accountId:ID}),"ACCOUNT_PROFILE_FAILED",502);
  await rejected(declined.invoke("setDefault",{sessionId:"s",accountId:ID}),"DEFAULT_ACCOUNT_FAILED",502);
  const f = fixture({catalog:()=>[{id:ID,usage:{percentUsed:-0,remaining:Infinity,entitlement:NaN},payload:1n}]});
  assert.deepEqual((await f.invoke("catalog",{sessionId:"s"})).accounts[0].usage,{});
});

test("slow account handlers cannot return private DTOs after revoke, cancellation or principal change", async () => {
  for (const method of ["catalog", "profile", "setDefault"]) for (const change of ["revoke", "cancel", "peer-dispose", "principal"]) {
    const entered = deferred(), release = deferred();
    let allowed = true;
    const handler = async () => {
      entered.resolve(); await release.promise;
      return method === "catalog" ? [{id:ID,login:"private-name"}] : method === "profile" ? {ok:true,avatarUrl:"https://private.example/image"} : {ok:true,defaultAccountId:ID};
    };
    const f = fixture({[method]:handler}), abort = new AbortController(), ctx = context("owner",()=>allowed);
    if (change === "peer-dispose") ctx.invocation.peer.signal = abort.signal;
    else ctx.invocation.signal = abort.signal;
    const pending = f.invoke(method,{sessionId:"s",accountId:ID},ctx);
    await entered.promise;
    if (change === "revoke") allowed = false;
    if (change === "cancel" || change === "peer-dispose") abort.abort();
    if (change === "principal") ctx.invocation.peer.principal = {kind:"share-viewer"};
    release.resolve();
    const cancelled = change === "cancel" || change === "peer-dispose";
    await rejected(pending,cancelled?"REQUEST_CANCELLED":change==="principal"?"OWNER_REQUIRED":"SESSION_FORBIDDEN",cancelled?499:403);
  }
});

test("bind result also rechecks access after awaited native model admission", async () => {
  const entered = deferred(), release = deferred();
  let allowed = true;
  const f = fixture({bind:async(request)=>{entered.resolve();await release.promise;return {accepted:selection,...state(request.sessionId)};}});
  const pending = f.invoke("bind",{sessionId:"s",accountId:ID},context("owner",()=>allowed));
  await entered.promise;
  allowed = false;release.resolve();
  await rejected(pending,"SESSION_FORBIDDEN",403);
});

test("catalog returns the latest Session route after slow profile/registry collection", async () => {
  let current = state("s");
  const f = fixture({read:()=>current,catalog:()=>{
    current = {...state("s"),running:true,next:{provider:"account-route",model:"gpt-5.4",mode:"bound",accountId:ID,available:true}};
    return [{id:ID,login:"alice"}];
  }});
  const result = await f.invoke("catalog",{sessionId:"s"});
  assert.equal(result.running,true);
  assert.equal(result.next.mode,"bound");
  assert.equal(result.next.accountId,ID);
  assert.equal(f.calls.filter((call)=>call.operation==="read").length,2);
});

test("cancelled invocation fails before touching Session or account handlers", async () => {
  const f = fixture(), controller = new AbortController(), ctx = context();
  controller.abort(); ctx.invocation.signal = controller.signal;
  await rejected(f.invoke("catalog",{sessionId:"s"},ctx),"REQUEST_CANCELLED",499);
  assert.deepEqual(f.calls,[]);
});
