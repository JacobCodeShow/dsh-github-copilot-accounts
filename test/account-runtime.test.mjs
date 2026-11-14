import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { loadAccountRuntime } from "../src/account-runtime.mjs";

const fakeModules = () => ({
  "@deepseek-ai/dsh-llm": { LlmAdapter: class {}, LlmError: class extends Error {}, resolveImageAttachmentAccess() {}, resolveRetryPolicy() {}, lastAssistantStreamChunk() {} },
  "@deepseek-ai/dsh-llm-pi-ai": { PiAiAdapter: class { prepareCall() {} current() {} }, Config() {}, apply() {} },
  "@deepseek-ai/cordis": { Context: class {} },
  "@deepseek-ai/dsh-typert-protocol": { Remote() {}, RemoteError: class extends Error {}, TypertRemoteService: class {}, principalOf() {} },
  "@earendil-works/pi-ai/providers/github-copilot": { githubCopilotProvider() {} },
  "@deepseek-ai/schemastery": { default: { object() {} } },
});

test("account runtime uses bound public Loader import and validates capabilities without credentials", async () => {
  const modules = fakeModules(), requests = [];
  const loader = { marker: true, import(specifier) { assert.equal(this.marker, true); requests.push(specifier); return modules[specifier]; } };
  const runtime = await loadAccountRuntime({ loader });
  assert.equal(typeof runtime.createAdapter, "function");
  assert.equal(Object.isFrozen(runtime), true);
  assert.deepEqual(requests.sort(), Object.keys(modules).sort());
});

test("unsupported runtime or loader errors are explicit, sanitized, and cannot use a caller adapter", async () => {
  await assert.rejects(loadAccountRuntime(), (error) => error.code === "ACCOUNT_RUNTIME_UNAVAILABLE");
  await assert.rejects(loadAccountRuntime({ importModule() { throw new Error("sensitive loader diagnostic"); } }), (error) => error.code === "ACCOUNT_RUNTIME_UNAVAILABLE" && !error.message.includes("sensitive"));
  const modules = fakeModules();
  delete modules["@deepseek-ai/dsh-llm-pi-ai"].PiAiAdapter.prototype.current;
  await assert.rejects(loadAccountRuntime({ importModule: async (name) => modules[name] }), (error) => error.code === "ACCOUNT_RUNTIME_UNAVAILABLE");
});

const root = new URL("../../dsh-session-account-review/installed/dsh/node_modules/", import.meta.url);
const loaderUrl = new URL("@deepseek-ai/cordis-plugin-loader/lib/index.js", root);
const present = existsSync(loaderUrl);
test("installed public Cordis Loader resolves native account runtime without app startup", { skip: present ? false : "optional extracted DSH installation fixture absent" }, async (t) => {
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Network forbidden in runtime import proof"); };
  t.after(() => { globalThis.fetch = previous; });
  const [{ Context }, { Loader }] = await Promise.all([
    import(new URL("@deepseek-ai/cordis/lib/index.js", root).href), import(loaderUrl.href),
  ]);
  const ctx = new Context();
  const loader = new Loader(ctx, { baseUrl: new URL("../", root).href });
  const runtime = await loadAccountRuntime({ loader });
  assert.equal(typeof runtime.createAdapter, "function");
  assert.equal(typeof runtime.resolveImageAccess, "function");
  assert.equal(typeof runtime.remoteProtocol.Remote, "function");
  const accountId = "copilot-auth/account-loader-proof";
  const adapter = await runtime.createAdapter({ accountId, routeId: "copilot-account-loader-proof",
    credentials: {
      async readRecord(id) { assert.equal(id, accountId); return { kind: "grant", payload: { type: "oauth", refresh: "FAKE_REFRESH_NOT_REAL", access: "FAKE_ACCESS_NOT_REAL", expires: Date.now() + 3600000, availableModelIds: ["gpt-5.4"] } }; },
      async modifyRecord() { assert.fail("metadata resolution must not refresh credentials"); },
    },
    profile: { models: [{ id: "gpt-5.4", maxTokens: 1234, contextWindow: 55555 }] },
  });
  const model = await adapter.resolveModel("copilot-account-loader-proof", "gpt-5.4");
  assert.equal(model.provider, "copilot-account-loader-proof");
  assert.equal(model.defaultMaxTokens, 1234);
  assert.equal(model.context.contextWindow, 55555);
  adapter.dispose();
  assert.equal(requests, 0);
  await ctx.fiber.dispose();
});
