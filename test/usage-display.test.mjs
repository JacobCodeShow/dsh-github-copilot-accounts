import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import * as avatarRecovery from "../src/avatar-recovery.mjs";
import * as usageSummary from "../src/usage-summary.mjs";

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
      if (name === "./usage-summary.mjs") return usageSummary;
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
test("badge popup follows the native DSH menu material", () => {
  const s = subject({ configured: true, usagePercent: 32 });
  const tree = s.CopilotBadge({ t: key => s.DICTS.en[key] ?? key });
  const popup = nodes(tree).find(node => node.props?.role === "dialog");
  assert.ok(popup);
  assert.equal(popup.props["aria-label"], s.DICTS.en.nav);
  assert.equal(popup.props.style.background, "var(--dsw-specific-menu, var(--dsw-alias-bg-base, var(--background, #fff)))");
  assert.equal(popup.props.style.backdropFilter, "var(--dsw-menu-backdrop-filter, none)");
  assert.equal(popup.props.style.color, "var(--dsw-alias-label-secondary, var(--foreground, #1a1a1a))");
  assert.equal(popup.props.style["--dsw-elevation-stroke-color"], "var(--dsw-alias-border-l1, rgba(128,128,128,0.1))");
  assert.equal(popup.props.style.border, 0);
  assert.equal(popup.props.style.borderRadius, "var(--dsw-radius-lg, 16px)");
  assert.equal(popup.props.style.boxShadow, "var(--dsw-elevation-prominent, 0 4px 12px rgba(0,0,0,0.15))");
  assert.equal(popup.props.style.width, "max-content");
  assert.equal(popup.props.style.minWidth, "min(300px, calc(100vw - 24px))");
});
for (const language of ["en", "zh"]) {
  test(`${language}: settings compare the used percentage to the UTC month and badge labels stay consistent`, () => {
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
      assert.equal(pill.props.style?.color === "var(--dsw-alias-state-error-primary, #e03131)", Math.round(value) > 80);
      const settingsBar = nodes(settings).find(node => node.props?.role === "img");
      assert.ok(settingsBar.props["aria-label"].includes(value.toFixed(1)));
      assert.ok(settingsBar.props["aria-label"].includes(language === "en" ? "UTC month elapsed" : "UTC 本月已过"));
      assert.ok(nodes(settingsBar).some(node => node.props?.style?.opacity === 0.55
        && node.props.style.width === `${Math.min(100, value)}%`));
      const badgeBar = nodes(badge).find(node => node.props?.role === "img");
      assert.equal(badgeBar.props["aria-label"], label);
      assert.ok(nodes(badgeBar).some(node => node.props?.style?.width === `${Math.min(100, value)}%`));
    }
  });
  test(`${language}: unknown and unlimited values are never fabricated percentages`, () => {
    for (const percentUsed of [undefined, null, NaN, Infinity, -1, "25"]) {
      const s = subject({ configured: true, usagePercent: percentUsed }), t = key => s.DICTS[language][key] ?? key;
      const settings = s.UsageBlock({ t, plan: "Synthetic", usage: { percentUsed } }), badge = s.CopilotBadge({ t });
      assert.ok(text(settings).includes("—"));
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
