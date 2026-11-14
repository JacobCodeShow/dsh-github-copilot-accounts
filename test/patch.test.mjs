import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";

const doc = YAML.parse(readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8"));

test("insert 本插件 host entry，name 与 package.json 一致", () => {
  const insert = doc.find((row) => Array.isArray(row.insert))?.insert ?? [];
  const self = insert.find((e) => e.id === "copilot-auth");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(self?.name, pkg.name);
});

test("会话策略使用两个消费者隔离域，不替换原始全局服务或配置", () => {
  const insert = doc.flatMap((row) => row.insert ?? []);
  const policy = insert.find((row) => row.id === "copilot-default-model-policy");
  const controller = doc.find((row) => row.id === "session-controller");
  const expected = { agentDefaultModel: "copilot-session-default-model", llm: "copilot-session-llm" };
  assert.equal(controller.name, "@deepseek-ai/dsh-api-session-controller");
  assert.deepEqual(controller.isolate, expected);
  assert.deepEqual(policy.isolate, expected);
  assert.equal(policy.name, "dsh-github-copilot-accounts/default-model");
  assert.equal(controller.config, undefined);
  assert.ok(!doc.some((row) => row.id === "agent-default-model"));
  assert.ok(!insert.some((row) => row.name === "@deepseek-ai/dsh-agent-default-model"));
});

test("会话账号路由不覆盖原生压缩角色", () => {
  const insert = doc.flatMap((row) => row.insert ?? []);
  assert.ok(!doc.some((row) => row.id === "compaction-basic"));
  assert.ok(!insert.some((row) => row.id === "copilot-session-compaction"));
});

test("策略子模块与完整 Host 模块会随 sideload 包分发，版本约束与锁文件一致", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./default-model"], "./src/default-model.mjs");
  assert.ok(pkg.files.includes("src/*.mjs"));
  assert.equal(pkg.engines.dsh, "^0.2.2-rc.1");
  assert.equal(pkg.peerDependencies["@deepseek-ai/cordis"], "~4.1.0");
  assert.equal(pkg.version, lock.version);
  assert.equal(pkg.version, lock.packages[""].version);
  assert.deepEqual(pkg.engines, lock.packages[""].engines);
  assert.deepEqual(pkg.peerDependencies, lock.packages[""].peerDependencies);
});

test("patch llm-pi-ai 行预置 github-copilot 路由（base 层，无 apiKeyEnv）", () => {
  const row = doc.find((e) => e.id === "llm-pi-ai" && !Array.isArray(e.insert));
  assert.equal(row?.name, "@deepseek-ai/dsh-llm-pi-ai");
  assert.equal(row?.config?.providers?.["github-copilot"]?.displayName, "GitHub Copilot");
  assert.equal(row?.config?.providers?.["github-copilot"]?.apiKeyEnv, undefined);
});
