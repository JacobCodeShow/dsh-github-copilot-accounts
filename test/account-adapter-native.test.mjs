// Optional installation-source integration. CI without the extracted offline
// fixture skips this test; the ordinary adapter tests need no DSH dependency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createAccountAdapter } from "../src/account-adapter.mjs";

const root = new URL("../../dsh-session-account-review/installed/dsh/node_modules/", import.meta.url);
const runtimeUrl = new URL("@deepseek-ai/dsh-llm-pi-ai/lib/index.js", root);
const present = existsSync(runtimeUrl);

test("installed native PiAiAdapter: concurrent isolation, multi-turn replay/tools and refresh (offline protocol)", { skip: present ? false : "optional extracted DSH installation fixture absent" }, async (t) => {
  const previousFetch = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden in offline native adapter test"); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const [{ PiAiAdapter }, { LlmAdapter, LlmError }, { githubCopilotProvider }] = await Promise.all([
    import(runtimeUrl.href), import(new URL("@deepseek-ai/dsh-llm/lib/index.js", root).href),
    import(new URL("@earendil-works/pi-ai/dist/providers/github-copilot.js", root).href),
  ]);
  const probe = githubCopilotProvider();
  const chosen = probe.getModels().find((m) => m.api === "anthropic-messages") ?? probe.getModels()[0];
  const records = new Map(), writes = [], refreshes = [], captures = [], tails = new Map();
  for (const letter of ["A", "B"]) records.set(`copilot-auth/account-${letter.toLowerCase()}`, { kind: "grant", payload: { type: "oauth", refresh: `FAKE_${letter}_REFRESH`, access: `FAKE_${letter}_ACCESS`, expires: Date.now() + 3600000, enterpriseUrl: `company-${letter.toLowerCase()}.ghe.com`, availableModelIds: [chosen.id], account: { login: "alice", domain: `company-${letter.toLowerCase()}.ghe.com` } } });
  const credentials = {
    async readRecord(key) { return structuredClone(records.get(key)); },
    modifyRecord(key, mutate) {
      const op = (tails.get(key) ?? Promise.resolve()).then(async () => { const next = await mutate(structuredClone(records.get(key))); if (next !== undefined) { records.set(key, structuredClone(next)); writes.push(key); } return structuredClone(records.get(key)); });
      tails.set(key, op.catch(() => {})); return op;
    },
  };
  let revokeOnRefresh = false, changeAccessBeforeProtocol = false;
  const nativeFactory = () => {
    const provider = githubCopilotProvider();
    const toAuth = provider.auth.oauth.toAuth;
    provider.auth = { ...provider.auth, oauth: { ...provider.auth.oauth,
      toAuth: async (credential) => {
        const auth = await toAuth(credential);
        if (changeAccessBeforeProtocol && credential.refresh === "FAKE_A_REFRESH") records.get("copilot-auth/account-a").payload.access = "FAKE_NEWER_SAME_ACCOUNT_ACCESS";
        return auth;
      },
      refresh: async (old) => { refreshes.push(old.refresh); return { ...old, access: old.access + "_ROTATED", expires: Date.now() + 3600000, ...(revokeOnRefresh ? { availableModelIds: [] } : {}) }; } } };
    provider.streamSimple = (model, context, options) => {
      captures.push({ model: structuredClone(model), context: structuredClone(context), apiKey: options.apiKey });
      return (async function* () {
        const content = [
          { type: "thinking", thinking: "offline reasoning", thinkingSignature: "FAKE_SIGNATURE_" + options.apiKey },
          { type: "toolCall", id: "fake-tool", name: "lookup", arguments: { query: "safe" }, thoughtSignature: "FAKE_TOOL_SIGNATURE", namespace: "FAKE_NAMESPACE" },
        ];
        const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: Date.now() };
        yield { type: "thinking_start", contentIndex: 0 };
        yield { type: "thinking_delta", contentIndex: 0, delta: "offline reasoning" };
        yield { type: "thinking_end", contentIndex: 0, content: "offline reasoning" };
        yield { type: "toolcall_start", contentIndex: 1, partial: message };
        yield { type: "toolcall_delta", contentIndex: 1, delta: '{"query":"safe"}' };
        yield { type: "toolcall_end", contentIndex: 1, toolCall: content[1] };
        yield { type: "done", reason: "toolUse", message };
      })();
    };
    return provider;
  };
  const make = (letter) => createAccountAdapter({ LlmAdapter, PiAiAdapter, LlmError, createNativeProvider: nativeFactory, credentials, accountId: `copilot-auth/account-${letter}`, routeId: `copilot-account-${letter}`, displayName: `company-${letter}.ghe.com/alice` });
  const a = make("a"), b = make("b");
  const user = { role: "user", content: [{ type: "text", text: "offline question" }] };
  const request = (letter, messages = [user]) => ({ provider: `copilot-account-${letter}`, model: chosen.id, messages, tools: [{ name: "lookup", description: "offline tool", parameters: { type: "object", properties: { query: { type: "string" } } } }] });
  const collect = async (iterable) => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks; };
  const [first, other] = await Promise.all([collect(a.stream(request("a"))), collect(b.stream(request("b")))]);
  assert.equal(first.at(-1).reason.kind, "tool-calls");
  assert.equal(other.at(-1).replayState.accountId, "copilot-auth/account-b");
  assert.deepEqual(captures.map((entry) => [entry.model.provider, entry.apiKey, entry.model.baseUrl]).sort(), [
    ["github-copilot", "FAKE_A_ACCESS", "https://copilot-api.company-a.ghe.com"],
    ["github-copilot", "FAKE_B_ACCESS", "https://copilot-api.company-b.ghe.com"],
  ]);
  const durable = { role: "assistant", content: first.filter((chunk) => chunk.type === "block-end").map((chunk) => chunk.block), source: { provider: "copilot-account-a", model: chosen.id, replayState: first.at(-1).replayState } };
  const tool = { role: "tool", toolCallId: "fake-tool", content: [{ type: "text", text: "offline tool result" }] };
  await collect(a.stream(request("a", [user, durable, tool])));
  const nativeOwn = captures.at(-1).context.messages.find((message) => message.role === "assistant");
  assert.equal(nativeOwn.provider, "github-copilot");
  assert.equal(nativeOwn.api, chosen.api);
  assert.equal(nativeOwn.content[0].thinkingSignature, "FAKE_SIGNATURE_FAKE_A_ACCESS");
  assert.equal(nativeOwn.content[1].thoughtSignature, "FAKE_TOOL_SIGNATURE");
  assert.equal(captures.at(-1).context.messages.at(-1).toolCallId, "fake-tool");
  await collect(b.stream(request("b", [user, durable, tool])));
  const nativeForeign = captures.at(-1).context.messages.find((message) => message.role === "assistant");
  assert.equal(nativeForeign.api, "dsh-foreign");
  assert.equal(nativeForeign.provider, "copilot-account-a");
  assert.equal(nativeForeign.content[0].thinkingSignature, undefined);
  assert.equal(nativeForeign.content[1].thoughtSignature, undefined);
  records.get("copilot-auth/account-a").payload.expires = 0;
  await Promise.all([collect(a.stream(request("a"))), collect(a.stream(request("a")))]);
  assert.deepEqual(refreshes, ["FAKE_A_REFRESH"]);
  assert.deepEqual(writes, ["copilot-auth/account-a"]);
  assert.equal(records.get("copilot-auth/account-b").payload.access, "FAKE_B_ACCESS");
  assert.deepEqual(records.get("copilot-auth/account-a").payload.account, { login: "alice", domain: "company-a.ghe.com" });
  const beforeConcurrent = captures.length;
  changeAccessBeforeProtocol = true;
  await collect(a.stream(request("a")));
  assert.equal(captures.length, beforeConcurrent + 1, "same-account token rotation does not invalidate a legitimate in-flight token");
  assert.notEqual(captures.at(-1).apiKey, records.get("copilot-auth/account-a").payload.access);
  changeAccessBeforeProtocol = false;
  const beforeRevocation = captures.length;
  records.get("copilot-auth/account-a").payload.expires = 0;
  revokeOnRefresh = true;
  await assert.rejects(collect(a.stream(request("a"))), (error) => error.code === "UNKNOWN_MODEL" && !error.message.includes("protocol-guard"));
  assert.equal(captures.length, beforeRevocation, "revoked model cannot reach the mocked native protocol after auth refresh");
  assert.deepEqual(records.get("copilot-auth/account-a").payload.availableModelIds, []);
  await collect(b.stream(request("b")));
  assert.equal(captures.at(-1).apiKey, "FAKE_B_ACCESS", "no fallback from revoked A to B");
  assert.equal(networkAttempts, 0);
});
