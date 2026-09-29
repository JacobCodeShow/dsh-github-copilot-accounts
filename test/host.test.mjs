import { test } from "node:test";
import assert from "node:assert/strict";
import plugin from "../src/host.mjs";

const MAIN = "llm-pi-ai/github-copilot";
const ENTERPRISE_PROMPT = { kind: "text", message: "GitHub Enterprise URL/domain (blank for github.com)" };

// 内存凭据库：语义对齐 dsh-credentials（modifyRecord 是唯一写路径，
// mutate 返回 undefined 不写；deleteRecord 对不存在记录 no-op）。
function makeStore(initial = {}) {
  const records = new Map(Object.entries(initial));
  return {
    records,
    deleted: [],
    async readRecord(k) { return records.get(k); },
    async describeRecord(k) {
      const r = records.get(k);
      return { configured: r !== undefined, kind: r?.kind, writable: true };
    },
    async listRecords() {
      return [...records.entries()].map(([key, r]) => ({ key, kind: r.kind }));
    },
    async modifyRecord(k, mutate) {
      const next = await mutate(records.get(k));
      if (next === undefined) return records.get(k);
      records.set(k, next);
      return next;
    },
    async deleteRecord(k) { records.delete(k); this.deleted.push(k); },
  };
}

function makeCtx(t, script = {}) {
  const ctx = {
    routes: [],
    prompts: [],
    promptAnswers: [],
    fetchCalls: [],
    webServer: { register: (r) => ctx.routes.push(r) },
    authorization: {
      beginCalls: [],
      begin: async (req) => {
        ctx.authorization.beginCalls.push(req);
        for (const n of ctx.script.notices) req.interaction.notify(n);
        if (ctx.script.prompt) {
          ctx.prompts.push(ctx.script.prompt);
          ctx.promptAnswers.push(await req.interaction.prompt(ctx.script.prompt));
        }
        if (ctx.script.reject) throw new Error(ctx.script.reject);
        if (ctx.script.hang) return new Promise(() => {});
        // pi-ai 在 authorized 前把新授权写进主 key——测试同构模拟。
        if (ctx.script.writtenOnAuthorized !== undefined) {
          ctx.credentials.records.set(MAIN, { kind: "grant", payload: ctx.script.writtenOnAuthorized });
        }
        return { status: ctx.script.outcome ?? "authorized" };
      },
    },
    credentials: makeStore(script.records),
    settings: {
      mutateCalls: [],
      mutate: async (ns, ops) => {
        ctx.settings.mutateCalls.push({ ns, ops });
        if (ctx.script.mutateError) throw new Error(ctx.script.mutateError);
      },
      describe: () => [{ ns: "llm-pi-ai", revision: ctx.script.revision ?? 1, user: ctx.script.userLayer }],
    },
    llm: { listModels: async () => ctx.script.served ?? [] },
    logger: { warns: [], warn: (...a) => ctx.logger.warns.push(a) },
    script: { notices: [], served: undefined, userLayer: undefined, ...script },
  };
  ctx.settings.get = () => ctx.script.configured;
  // fetch 桩：默认一律 500（mock down）——身份/用量失败走各自的降级路径。
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    ctx.fetchCalls.push({ url, init });
    if (ctx.script.fetchImpl) return ctx.script.fetchImpl(url, ctx.fetchCalls.length);
    return { ok: false, status: 500, statusText: "mock down", json: async () => ({}) };
  };
  t.after(() => { globalThis.fetch = realFetch; });
  plugin.apply(ctx);
  return ctx;
}

const handler = (ctx, suffix) => ctx.routes.find((r) => r.path.endsWith(suffix)).handler;
const call = async (h, req = {}) => {
  const res = { code: 0, body: null,
    writeHead(c) { this.code = c; }, end(b) { this.body = b ? JSON.parse(b) : null; } };
  await h({ headers: { host: "127.0.0.1:8815", ...req.headers }, method: req.method ?? "GET",
    body: req.body }, res);
  return res;
};
const sleep = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// /user（身份）与 copilot_internal/user（用量）的常用假响应。
const identityResponse = (login = "octocat") => ({
  ok: true, status: 200, statusText: "OK",
  json: async () => ({ login, name: "Octo Cat", avatar_url: "https://avatars.example/u.png" }),
});
const usageResponse = (plan = "enterprise", percentRemaining = 34) => ({
  ok: true, status: 200, statusText: "OK",
  json: async () => ({
    copilot_plan: plan,
    quota_reset_date: "2026-10-01",
    quota_snapshots: { premium_interactions: { entitlement: 1000, remaining: 660, percent_remaining: percentRemaining, unlimited: false } },
  }),
});

test("插件身份与路由注册", (t) => {
  const ctx = makeCtx(t);
  assert.equal(plugin.name, "copilot-auth");
  assert.deepEqual(plugin.inject, ["webServer", "authorization", "credentials", "settings", "llm"]);
  assert.ok(ctx.routes.every((r) => r.kind === "exact"), "所有路由必须都是 exact");
  assert.deepEqual(ctx.routes.map((r) => r.path).sort(),
    ["/copilot-auth/accounts", "/copilot-auth/activate", "/copilot-auth/cancel", "/copilot-auth/debug",
      "/copilot-auth/logout", "/copilot-auth/open", "/copilot-auth/refresh", "/copilot-auth/start",
      "/copilot-auth/state", "/copilot-auth/whoami"]);
});

test("start/github.com：begin key/method 正确，Enterprise 提问答空串", async (t) => {
  const ctx = makeCtx(t, { prompt: ENTERPRISE_PROMPT });
  const res = await call(handler(ctx, "/start"), { method: "POST", headers: { origin: "http://127.0.0.1:8815" }, body: { kind: "github.com" } });
  assert.equal(res.code, 202);
  await sleep();
  const [req] = ctx.authorization.beginCalls;
  assert.equal(req.key, MAIN);
  assert.equal(req.method, "oauth");
  assert.equal(ctx.promptAnswers[0], "");
  const state = await call(handler(ctx, "/state"));
  assert.equal(state.body.status, "authorized");
  assert.equal(state.body.kind, "github.com");
});

test("start 校验：kind 非法 / ghe.com 缺域名 / 非法 JSON 均 400", async (t) => {
  const ctx = makeCtx(t);
  assert.equal((await call(handler(ctx, "/start"), { method: "POST", body: { kind: "ldap" } })).code, 400);
  assert.equal((await call(handler(ctx, "/start"), { method: "POST", body: { kind: "ghe.com" } })).code, 400);
  assert.equal((await call(handler(ctx, "/start"), { method: "POST", body: { kind: "ghe.com", domain: "not a domain!" } })).code, 400);
  assert.equal((await call(handler(ctx, "/start"), { method: "POST", body: "not-json" })).code, 400);
  assert.equal(ctx.authorization.beginCalls.length, 0, "校验失败不得调起 begin");
});

test("start/ghe.com：合法域名被答复进 Enterprise 提问，state 记录 kind/domain", async (t) => {
  const ctx = makeCtx(t, { prompt: ENTERPRISE_PROMPT });
  const res = await call(handler(ctx, "/start"), { method: "POST", body: { kind: "ghe.com", domain: "https://company.ghe.com/" } });
  assert.equal(res.code, 202);
  await sleep();
  assert.equal(ctx.promptAnswers[0], "company.ghe.com", "带协议输入应归一为裸 host 再答复");
  const state = await call(handler(ctx, "/state"));
  assert.equal(state.body.kind, "ghe.com");
  assert.equal(state.body.domain, "company.ghe.com");
});

test("ghe.com 防呆：设备码链接 host ≠ 期望域名时就地置败，authorized 不翻盘", async (t) => {
  const ctx = makeCtx(t, {
    hang: true,
    notices: [{ message: "Enter this code", url: "https://github.com/login/device", code: "ABCD-1234" }],
  });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "ghe.com", domain: "company.ghe.com" } });
  await sleep();
  const state = await call(handler(ctx, "/state"));
  assert.equal(state.body.status, "failed");
  assert.match(state.body.error, /企业域名未生效/);
});

test("unexpected prompt 使 attempt 失败并进入 failed 态", async (t) => {
  const ctx = makeCtx(t, { prompt: { kind: "secret", message: "Enter API key" } });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  await sleep();
  const res = await call(handler(ctx, "/state"));
  assert.equal(res.body.status, "failed");
  assert.ok(res.body.error.includes("unexpected prompt"));
});

test("begin 以 cancelled resolve 时映射为 failed（AuthorizationOutcome 双态）", async (t) => {
  const ctx = makeCtx(t, { outcome: "cancelled" });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  await sleep();
  const res = await call(handler(ctx, "/state"));
  assert.equal(res.body.status, "failed");
  assert.match(res.body.error, /取消/);
});

test("设备码 notice 经 state 可见；running 期间二次 start 返回 409", async (t) => {
  const ctx = makeCtx(t, {
    hang: true,
    notices: [{ message: "Enter this code", url: "https://github.com/login/device", code: "ABCD-1234" }],
  });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  const state = await call(handler(ctx, "/state"));
  assert.equal(state.body.status, "running");
  assert.deepEqual(state.body.notices.at(-1),
    { message: "Enter this code", url: "https://github.com/login/device", code: "ABCD-1234" });
  const again = await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  assert.equal(again.code, 409);
});

test("登录成功建槽（身份入 payload.account）且 /accounts 标记激活与用量", async (t) => {
  const ctx = makeCtx(t, {
    writtenOnAuthorized: { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3_600_000, availableModelIds: ["gpt-5.4"] },
    fetchImpl: (url) => {
      if (url.includes("copilot_internal/user")) return usageResponse();
      if (url.endsWith("/user")) return identityResponse();
      return { ok: false, status: 500, statusText: "mock down", json: async () => ({}) };
    },
  });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  await sleep();
  const state = await call(handler(ctx, "/state"));
  assert.equal(state.body.status, "authorized");
  const slot = ctx.credentials.records.get("copilot-auth/account-octocat");
  assert.ok(slot, "登录成功后应建槽 account-octocat");
  assert.equal(slot.kind, "grant");
  assert.deepEqual(slot.payload.account, { login: "octocat", name: "Octo Cat", avatarUrl: "https://avatars.example/u.png", domain: "github.com" });
  const list = await call(handler(ctx, "/accounts"));
  assert.deepEqual(list.body.accounts, [{
    login: "octocat",
    name: "Octo Cat",
    avatarUrl: "https://avatars.example/u.png",
    domain: "github.com",
    active: true,
    plan: "Copilot Enterprise",
    usage: { percentUsed: 66, entitlement: 1000, remaining: 660, unlimited: false, resets: "2026-10-01" },
  }]);
  assert.equal(list.body.accounts[0].usageError, undefined);
});

test("登录前快照防丢（v0.1.0 升级）：既有主凭据先落槽再被新登录覆盖", async (t) => {
  const ctx = makeCtx(t, {
    records: { [MAIN]: { kind: "grant", payload: { type: "oauth", refresh: "r0", access: "a0", expires: Date.now() + 3_600_000 } } },
    writtenOnAuthorized: { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3_600_000 },
    // fetch 全 500：快照走 identity:false 不发起网络；新登录身份失败落 recovered。
  });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  await sleep();
  const snapshot = ctx.credentials.records.get("copilot-auth/account-recovered-1");
  assert.ok(snapshot, "旧凭据应在登录覆盖前落槽");
  assert.equal(snapshot.payload.refresh, "r0");
  assert.equal(snapshot.payload.account, undefined, "快照路径不做网络查询，无元数据");
  assert.equal(ctx.credentials.records.get(MAIN).payload.refresh, "r1");
  assert.ok(ctx.credentials.records.get("copilot-auth/account-recovered-2"), "新登录身份取不到时也落 recovered 占位");
});

test("已有槽位（refresh 匹配）不重复建槽：原位更新 payload 并保留元数据", async (t) => {
  const meta = { login: "octocat", name: "Octo Cat", avatarUrl: "https://avatars.example/u.png", domain: "github.com" };
  const ctx = makeCtx(t, {
    records: { "copilot-auth/account-octocat": { kind: "grant", payload: { type: "oauth", refresh: "r0", access: "a0", expires: 1, availableModelIds: ["gpt-5.4"], account: meta } } },
    writtenOnAuthorized: { type: "oauth", refresh: "r0", access: "a2", expires: Date.now() + 3_600_000, availableModelIds: ["gpt-5.4", "gemini-3.8-flash"] },
  });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  await sleep();
  const slots = [...ctx.credentials.records.keys()].filter((k) => k.startsWith("copilot-auth/account-"));
  assert.deepEqual(slots, ["copilot-auth/account-octocat"]);
  const payload = ctx.credentials.records.get("copilot-auth/account-octocat").payload;
  assert.equal(payload.access, "a2");
  assert.deepEqual(payload.account, meta, "身份查询失败也不得丢已有元数据");
});

test("accounts 迁移：主凭据无槽位时补建（含身份回填）", async (t) => {
  const ctx = makeCtx(t, {
    records: { [MAIN]: { kind: "grant", payload: { type: "oauth", refresh: "r0", access: "a0", expires: Date.now() + 3_600_000, availableModelIds: ["gpt-5.4"] } } },
    fetchImpl: (url) => (url.endsWith("/user") ? identityResponse() : undefined),
  });
  const list = await call(handler(ctx, "/accounts"));
  assert.equal(list.body.accounts.length, 1);
  assert.equal(list.body.accounts[0].login, "octocat");
  assert.equal(list.body.accounts[0].active, true);
  assert.ok(ctx.credentials.records.get("copilot-auth/account-octocat"), "读列表应补建迁移槽位");
});

test("activate：槽位 payload 原子写入主 key 并触发目录同步；未知账号 404", async (t) => {
  const ctx = makeCtx(t, {
    records: {
      [MAIN]: { kind: "grant", payload: { type: "oauth", refresh: "r0", access: "a0", expires: 1 } },
      "copilot-auth/account-alice": { kind: "grant", payload: { type: "oauth", refresh: "r0", access: "a0", expires: 1 } },
      "copilot-auth/account-octocat": { kind: "grant", payload: { type: "oauth", refresh: "r1", access: "a1", expires: 1, availableModelIds: ["gpt-5.4"] } },
    },
    served: [{ id: "gpt-5.4" }],
  });
  assert.equal((await call(handler(ctx, "/activate"), { method: "POST", body: { login: "nobody" } })).code, 404);
  assert.equal((await call(handler(ctx, "/activate"), { method: "POST", body: {} })).code, 400);
  const ok = await call(handler(ctx, "/activate"), { method: "POST", body: { login: "octocat" } });
  assert.equal(ok.body.ok, true);
  assert.equal(ctx.credentials.records.get(MAIN).payload.refresh, "r1");
  await sleep();
  assert.equal(ctx.settings.mutateCalls.length, 1, "激活后应同步模型目录");
  assert.deepEqual(ctx.settings.mutateCalls[0].ops[0].value, [{ id: "gpt-5.4" }]);
});

test("logout：非激活只删槽位；激活账号连主 key 一起删；legacy 主凭据直接清", async (t) => {
  // main r0 ↔ alice（激活），octocat r1（非激活）
  const ctx = makeCtx(t, {
    records: {
      [MAIN]: { kind: "grant", payload: { type: "oauth", refresh: "r0", access: "a0" } },
      "copilot-auth/account-alice": { kind: "grant", payload: { type: "oauth", refresh: "r0", access: "a0" } },
      "copilot-auth/account-octocat": { kind: "grant", payload: { type: "oauth", refresh: "r1", access: "a1" } },
    },
  });
  assert.equal((await call(handler(ctx, "/logout"), { method: "POST", body: { login: "nobody" } })).body.ok, true, "无此账号幂等 ok");
  assert.equal((await call(handler(ctx, "/logout"), { method: "POST", body: { login: "octocat" } })).body.ok, true);
  assert.equal(ctx.credentials.records.has(MAIN), true, "非激活注销不动主 key");
  assert.equal(ctx.credentials.records.has("copilot-auth/account-octocat"), false);
  assert.equal((await call(handler(ctx, "/logout"), { method: "POST", body: { login: "octocat" } })).body.ok, true, "重复注销仍 ok");
  assert.equal((await call(handler(ctx, "/logout"), { method: "POST", body: { login: "alice" } })).body.ok, true, "激活账号注销连主 key");
  assert.equal(ctx.credentials.records.has(MAIN), false);
  assert.equal((await call(handler(ctx, "/logout"), { method: "POST", body: {} })).body.ok, true, "无 body 时无激活账号也 ok");
  // legacy：主凭据无槽位
  const ctx2 = makeCtx(t, { records: { [MAIN]: { kind: "grant", payload: { type: "oauth", refresh: "r9" } } } });
  assert.equal((await call(handler(ctx2, "/logout"), { method: "POST" })).body.ok, true);
  assert.equal(ctx2.credentials.records.has(MAIN), false);
});

test("用量：直接用 refresh token 调 copilot_internal/user，200 成功", async (t) => {
  const ctx = makeCtx(t, {
    records: { "copilot-auth/account-octocat": { kind: "grant", payload: { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3_600_000, account: { login: "octocat", domain: "github.com" } } } },
    fetchImpl: (url) => {
      if (url.includes("copilot_internal/user")) return usageResponse("business", 12);
      return { ok: false, status: 500, statusText: "mock down", json: async () => ({}) };
    },
  });
  const list = await call(handler(ctx, "/accounts"));
  assert.equal(list.body.accounts[0].plan, "Copilot Business");
  assert.equal(list.body.accounts[0].usage.percentUsed, 88);
  assert.equal(list.body.accounts[0].active, false, "主凭据为空时无激活账号");
  // refresh token 直接用量，不应调 v2/token 刷新 access token
  assert.ok(!ctx.fetchCalls.some((c) => c.url.includes("copilot_internal/v2/token")));
  assert.equal(ctx.fetchCalls.filter((c) => c.url.includes("copilot_internal/user")).length, 1);
});

test("用量缓存：TTL 内重复拉列表不再发起用量请求；失败降级 usageError", async (t) => {
  const ctx = makeCtx(t, {
    records: { "copilot-auth/account-octocat": { kind: "grant", payload: { type: "oauth", refresh: "r1", access: "a1", expires: Date.now() + 3_600_000, account: { login: "octocat", domain: "github.com" } } } },
    fetchImpl: (url) => (url.includes("copilot_internal/user")
      ? { ok: false, status: 503, statusText: "unavailable", json: async () => ({}) }
      : undefined),
  });
  await call(handler(ctx, "/accounts"));
  const first = (await call(handler(ctx, "/accounts"))).body.accounts[0];
  assert.match(first.usageError, /usage 503/);
  assert.equal(first.usage, undefined);
  assert.equal(ctx.fetchCalls.filter((c) => c.url.includes("copilot_internal/user")).length, 1, "TTL 内不重复请求");
});

test("authorized 后把发现的可用模型写入用户 settings 的模型目录（目录外 id 排除）", async (t) => {
  const ctx = makeCtx(t, {
    writtenOnAuthorized: { type: "oauth", refresh: "r1", access: "a1", expires: 1, availableModelIds: ["gpt-5.6-luna", "gpt-5.4", "gemini-3.8-flash"] },
    served: [{ id: "gpt-5.6-luna" }, { id: "gpt-5.4" }], // 运行时目录未描述 gemini-3.8-flash
  });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  await sleep();
  assert.equal(ctx.settings.mutateCalls.length, 1);
  const { ns, ops } = ctx.settings.mutateCalls[0];
  assert.equal(ns, "llm-pi-ai");
  assert.deepEqual(ops[0].path, ["providers", "github-copilot", "models"]);
  assert.deepEqual(ops[0].value, [{ id: "gpt-5.6-luna" }, { id: "gpt-5.4" }]);
});

test("挂载不再同步模型目录——即使已登录也不触碰用户 settings", async (t) => {
  const ctx = makeCtx(t, {
    records: { [MAIN]: { kind: "grant", payload: { type: "oauth", refresh: "r0", availableModelIds: ["gpt-5.4", "gemini-3.8-flash"] } } },
    served: [{ id: "gpt-5.4" }],
  });
  await sleep();
  assert.equal(ctx.settings.mutateCalls.length, 0);
});

test("登录/激活时目录已存在（含空列表）或仅 modelOverrides 则不写入——用户精简不被重置", async (t) => {
  const custom = [{ id: "gpt-5.4" }, { id: "claude-opus-4.8" }, { id: "gemini-3.7-flash" }];
  for (const [label, configured] of [
    ["models", { providers: { "github-copilot": { models: custom } } }],
    ["空 models", { providers: { "github-copilot": { models: [] } } }],
    ["modelOverrides", { providers: { "github-copilot": { modelOverrides: { "gpt-5.4": { displayName: "我的 GPT" } } } } }],
  ]) {
    const ctx = makeCtx(t, {
      writtenOnAuthorized: { type: "oauth", refresh: "r1", access: "a1", expires: 1, availableModelIds: ["gpt-5.4", "gemini-3.8-flash"] },
      configured,
    });
    await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
    await sleep();
    assert.equal(ctx.settings.mutateCalls.length, 0, `${label} 应视作用户所有`);
  }
});

test("模型同步失败时经 /accounts 暴露 syncError", async (t) => {
  const ctx = makeCtx(t, {
    writtenOnAuthorized: { type: "oauth", refresh: "r1", access: "a1", expires: 1, availableModelIds: ["gpt-5.4"] },
    served: [{ id: "gpt-5.4" }],
    mutateError: "validation boom",
  });
  await call(handler(ctx, "/start"), { method: "POST", body: { kind: "github.com" } });
  await sleep();
  const res = await call(handler(ctx, "/accounts"));
  assert.equal(res.body.syncError, "validation boom");
});

test("跨站 Origin 拒绝 403，同源/无 Origin 放行", async (t) => {
  const ctx = makeCtx(t);
  assert.equal((await call(handler(ctx, "/start"), { method: "POST", headers: { origin: "http://evil.example" }, body: { kind: "github.com" } })).code, 403);
  assert.equal((await call(handler(ctx, "/accounts"))).code, 200);
});
