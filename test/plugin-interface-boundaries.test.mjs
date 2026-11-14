import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Production transport policy belongs to DSH's launcher, not to an account
// plugin. Test mocks may replace fetch, but distributed src modules must not.
test("production plugin does not override process HTTP or inspect token environment", () => {
  const root = new URL("../src/", import.meta.url);
  for (const name of readdirSync(root).filter((value) => value.endsWith(".mjs") || value.endsWith(".jsx"))) {
    const source = readFileSync(new URL(name, root), "utf8");
    assert.doesNotMatch(source, /globalThis\.fetch\s*=/, name);
    assert.doesNotMatch(source, /\bsetGlobalDispatcher\s*\(/, name);
    assert.doesNotMatch(source, /process\.env\.(?:GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|COPILOT_GITHUB_TOKEN)\b/, name);
    assert.doesNotMatch(source, /\b(snapshotEvents|eventAt|ownEvents)\s*\(/, "new production Session logic must use normative projections/query APIs: " + name);
  }
});

test("Host diagnostics expose fixed status, not proxy URLs or implicit network probes", () => {
  const source = readFileSync(new URL("../src/host.mjs", import.meta.url), "utf8");
  const debug = source.slice(source.indexOf("path: `${ROUTE_PREFIX}/debug`"), source.indexOf("// Existing global/settings endpoints"));
  assert.ok(debug.includes('proxyPolicy: "host-managed"'));
  assert.doesNotMatch(debug, /process\.env|fetch\s*\(|String\([^)]*err/);
});
