import { test } from "node:test";
import assert from "node:assert/strict";
import { accountRouteId, isAccountRoute, normalizeDefaultSelection } from "../src/account-route-id.mjs";

test("account routes are deterministic opaque slot identities and do not collide across slots", () => {
  const a = accountRouteId("copilot-auth/account-alice");
  assert.match(a, /^copilot-account-[a-f0-9]{64}$/);
  assert.equal(a, accountRouteId("copilot-auth/account-alice"));
  assert.notEqual(a, accountRouteId("copilot-auth/account-alice-2"));
  assert.equal(isAccountRoute(a), true);
  for (const id of ["", null, "llm-pi-ai/github-copilot", "copilot-auth/../account-alice", "copilot-auth/account-Alice"]) {
    assert.throws(() => accountRouteId(id), /Invalid Copilot/);
  }
});

test("only our exact account routes normalize global default provider without mutating selection", () => {
  const bound = Object.freeze({ provider: accountRouteId("copilot-auth/account-alice"), model: "gpt-5.4", reasoningEffort: "high" });
  assert.deepEqual(normalizeDefaultSelection(bound), { provider: "github-copilot", model: "gpt-5.4", reasoningEffort: "high" });
  assert.notEqual(bound.provider, "github-copilot");
  for (const provider of ["github-copilot", "openai", "copilot-account-x", "copilot-account-" + "0".repeat(63), "other-copilot-account-" + "0".repeat(64)]) {
    const selection = Object.freeze({ provider, model: "model", reasoningEffort: "low" });
    const normalized = normalizeDefaultSelection(selection);
    assert.deepEqual(normalized, selection);
    assert.notEqual(normalized, selection, "return detached selection without mutating caller state");
  }
});
