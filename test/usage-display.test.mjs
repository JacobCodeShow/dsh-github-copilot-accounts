import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import * as avatarRecovery from "../src/avatar-recovery.mjs";

// Compile the actual existing UI; injected hooks expose its render tree without
// starting a browser, polling accounts, or sending network requests.
const source = await readFile(new URL("../src/client.jsx", import.meta.url), "utf8");
const compiled = await build({ stdin: { contents: source + "\nexport { usedQuota, quotaText, UsageBlock, CopilotBadge, DICTS };", loader: "jsx" },
  format: "cjs", platform: "browser", jsx: "automatic", write: false, logLevel: "silent" });
function subject(whoami = {}, open = true) {
  const states = [whoami, [], open, null], exports = {}, element = (type, props) => ({ type, props });
  const context = { module: { exports }, exports, document: { body: {} }, window: { innerHeight: 800 },
    fetch() { assert.fail("No network in percentage display tests"); },
    require(name) {
      if (name === "react") return { useState: () => [states.shift(), () => {}], useEffect() {},
        useRef: () => ({ current: { getBoundingClientRect: () => ({ left: 10, top: 500 }) } }) };
      if (name === "react-dom") return { createPortal: (node) => node };
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "fragment" };
      if (name === "./avatar-recovery.mjs") return avatarRecovery;
      throw new Error("Unexpected UI dependency");
    } };
  vm.runInNewContext(compiled.outputFiles[0].text, context, { timeout: 5000 });
  return context.module.exports;
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}
for (const language of ["en", "zh"]) {
  test(`${language}: settings, collapsed badge and expanded panel show the same used percentage`, () => {
    for (const value of [0, 25, 80, 81, 100, 23.6, 120]) {
      const s = subject({ configured: true, usagePercent: value, usageUnlimited: false }), t = key => s.DICTS[language][key] ?? key;
      const label = t("quotaUsed").replace("{percent}", String(Math.round(value)));
      const settings = s.UsageBlock({ t, plan: "Synthetic", usage: { percentUsed: value } });
      const badge = s.CopilotBadge({ t }), all = nodes(badge);
      assert.ok(text(settings).includes(label));
      const pill = all.find(node => node.props?.className === "copilot-badge-label");
      assert.equal(text(pill), label);
      assert.ok(all.some(node => node.props?.style?.fontSize === 20 && text(node) === label), "expanded panel uses identical label");
      assert.ok(all.some(node => typeof node.props?.title === "string" && node.props.title.includes(label)), "tooltip uses identical convention");
      assert.equal(pill.props.style?.color === "#e03131", Math.round(value) > 80);
      for (const tree of [settings, badge]) {
        const bar = nodes(tree).find(node => node.props?.role === "img");
        assert.equal(bar.props["aria-label"], label);
        assert.equal(bar.props.children.props.style.width, `${Math.min(100, value)}%`);
      }
    }
  });
  test(`${language}: unknown and unlimited values are never fabricated percentages`, () => {
    for (const percentUsed of [undefined, null, NaN, Infinity, -1, "25"]) {
      const s = subject({ configured: true, usagePercent: percentUsed }), t = key => s.DICTS[language][key] ?? key;
      const settings = s.UsageBlock({ t, plan: "Synthetic", usage: { percentUsed } }), badge = s.CopilotBadge({ t });
      assert.ok(text(settings).includes(t("quotaUnknown")));
      assert.ok(text(badge).includes(t("quotaUnknown")));
      assert.equal(nodes(settings).some(n => n.props?.role === "img"), false);
      assert.equal(nodes(badge).some(n => n.props?.role === "img"), false);
    }
    const s = subject({ configured: true, usagePercent: 0, usageUnlimited: true }), t = key => s.DICTS[language][key] ?? key;
    for (const tree of [s.UsageBlock({ t, usage: { percentUsed: 0, unlimited: true } }), s.CopilotBadge({ t })]) {
      assert.ok(text(tree).includes(t("unlimited")));
      assert.ok(!text(tree).includes("0%"));
      assert.equal(nodes(tree).some(n => n.props?.role === "img"), false);
    }
  });
}
test("usage errors keep unavailable state rather than presenting an old percentage", () => {
  const s = subject(), t = key => s.DICTS.en[key] ?? key;
  const tree = s.UsageBlock({ t, usage: { percentUsed: 25 }, usageError: "unavailable" });
  assert.ok(text(tree).includes(t("usageFailed"))); assert.ok(!text(tree).includes("25%"));
});
