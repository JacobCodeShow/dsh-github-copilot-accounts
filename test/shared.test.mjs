import { test } from "node:test";
import assert from "node:assert/strict";
import { accountKey, accountSlotId } from "../src/shared.mjs";

test("账号 key 隔离域名，并归一化 URL 和用户名大小写", () => {
  const a = accountKey("alice", "company-a.ghe.com");
  assert.notEqual(a, accountKey("alice", "company-b.ghe.com"));
  assert.notEqual(a, accountKey("alice", "github.com"));
  assert.equal(a, accountKey("ALICE", "https://COMPANY-A.ghe.com/"));
  assert.match(a, /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/);
  assert.equal(accountKey("alice"), "copilot-auth/account-alice", "旧 key 格式保持可读");
  assert.throws(() => accountKey("alice", ""), /invalid account domain/);
});

test("账号编码不会因域名分隔符、EMU 下划线或 recovered 名称碰撞", () => {
  assert.notEqual(accountSlotId("alice", "a.b.ghe.com"), accountSlotId("alice", "a-b.ghe.com"));
  assert.notEqual(accountSlotId("alice_emu", "company.ghe.com"), accountSlotId("alice-emu", "company.ghe.com"));
  assert.notEqual(accountKey("recovered-1", "github.com"), accountKey("recovered-1"));
});
