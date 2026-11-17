import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

// Actual settings components with synthetic hook state, no DOM/network polling.
async function subject(accounts) {
  const code = await readFile(new URL("../src/client.jsx", import.meta.url), "utf8");
  const built = await build({ stdin: { contents: code + "\nexport { CopilotSection, UsageBlock, DICTS };", loader: "jsx", resolveDir: fileURLToPath(new URL("../src/", import.meta.url)) },
    bundle: true, external: ["react", "react-dom", "react/jsx-runtime"], format: "cjs", platform: "browser", jsx: "automatic", write: false, logLevel: "silent" });
  const exports = {}, element = (type, props) => ({ type, props });
  const instant = Date.UTC(2026, 10, 15, 12);
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } }
  let supplied = false;
  const context = { module: { exports }, exports, Date: Clock, console: { log() {}, warn() {} },
    fetch() { assert.fail("No network in settings-render tests"); },
    require(name) {
      if (name === "react") return { useState(initial) {
        if (initial === null && !supplied) { supplied = true; return [accounts, () => {}]; }
        return [typeof initial === "function" ? initial() : initial, () => {}];
      }, useEffect() {}, useRef(initial) { return { current: initial }; } };
      if (name === "react-dom") return { createPortal: node => node };
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "fragment" };
      throw new Error("Unexpected client dependency");
    } };
  vm.runInNewContext(built.outputFiles[0].text, context, { timeout: 5000 });
  return context.module.exports;
}
function render(node) {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== "object") return node;
  if (typeof node.type === "function") return render(node.type(node.props));
  return { ...node, props: { ...node.props, children: render(node.props?.children) } };
}
function nodes(node) { return Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== "object" ? [] : [node, ...nodes(node.props?.children)]; }
function text(node) { return Array.isArray(node) ? node.map(text).join("") : node === null || node === undefined || typeof node === "boolean" ? "" : typeof node === "object" ? text(node.props?.children) : String(node); }
const account = (id, used) => ({ id, login: "alice", domain: id + ".ghe.com", plan: "Copilot Enterprise", usage: { percentUsed: used, resets: "2026-12-01" } });
for (const locale of ["en", "zh"]) test(`${locale}: compact settings share one summary and align per-account UTC markers`, async () => {
  const s = await subject([account("a", 25), account("b", 75)]), t = key => s.DICTS[locale][key] ?? key;
  const tree = render(s.CopilotSection({ t })), all = nodes(tree);
  const by = key => all.filter(node => Object.hasOwn(node.props, key));
  assert.equal(by("data-usage-month").length, 1);
  assert.equal(by("data-usage-legend").length, 1);
  assert.equal(by("data-combined-usage").length, 1);
  assert.ok(text(by("data-combined-usage")[0]).includes("100%")); assert.ok(text(by("data-combined-usage")[0]).includes("200%"));
  const tracks = by("data-usage-track"), markers = tracks.map(track => nodes(track).find(node => Object.hasOwn(node.props, "data-month-marker")));
  assert.equal(tracks.length, 2); assert.ok(markers.every(Boolean));
  assert.equal(markers[0].props.style.left, markers[1].props.style.left);
  assert.ok(Math.abs(parseFloat(markers[0].props.style.left) - (14.5 / 30 * 100)) < 0.001);
  assert.equal(all.filter(node => node.type === "p" && text(node) === t("creditsNote")).length, 1);
  const plans = all.filter(node => node.type === "span" && text(node) === t("plan")); assert.equal(plans.length, 2);
  for (const plan of plans) assert.ok(all.some(parent => parent.props.style?.display === "flex" && nodes(parent.props.children).includes(plan) && text(parent).includes("Copilot Enterprise")));
  assert.equal(by("data-usage-trend").length, 0);
});
test("single-account settings hide combined total", async () => {
  const s = await subject([account("a", 25)]), t = key => s.DICTS.en[key] ?? key;
  const all = nodes(render(s.CopilotSection({ t })));
  assert.equal(all.filter(node => Object.hasOwn(node.props, "data-combined-usage")).length, 0);
});
test("account settings use live theme tokens for cards, usage markers and controls", async () => {
  const s = await subject([account("a", 25)]), t = key => s.DICTS.en[key] ?? key;
  const tree = render(s.CopilotSection({ t })), all = nodes(tree);
  assert.equal(tree.props.style.color, "var(--dsw-alias-label-primary, inherit)");
  const card = all.find(node => node.props?.style?.padding === "12px 14px");
  assert.equal(card.props.style.background, "var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2, transparent))");
  assert.ok(card.props.style.border.includes("--dsw-alias-settings-card-stroke"));
  const used = all.find(node => Object.hasOwn(node.props, "data-usage-marker"));
  const month = all.find(node => Object.hasOwn(node.props, "data-month-marker"));
  assert.equal(used.props.style.background, "var(--dsw-alias-state-business-primary, #4c6ef5)");
  assert.equal(month.props.style.background, "var(--dsw-alias-state-warn-primary, #d9a441)");
  const add = all.find(node => node.type === "button" && text(node).includes(t("addAccount")));
  assert.ok(add.props.style.border.includes("--dsw-alias-border-l4"));
});
test("settings registers its icon using matching public slot id and owns its locale", async () => {
  const s = await subject([]), registrations = [], effects = [];
  const locale = new Map();
  const ctx = { effect(fn) { const release = fn(); if (typeof release === "function") effects.push(release); },
    locale: { register(ns, data) { assert.equal(locale.has(ns), false); locale.set(ns, data); return () => locale.delete(ns); }, bind: () => key => key },
    slots: { inject(_name, fn) { ctx.effect(fn); }, register(meta, component) { registrations.push({ meta, component }); return () => {}; } } };
  s.apply(ctx);
  const section = registrations.find(row => row.meta.name === "settings.section"), icon = registrations.find(row => row.meta.name === "settings.section.icon");
  assert.ok(section && icon); assert.equal(section.meta.id, icon.meta.id);
  const svg = icon.component({ size: 24, active: false });
  assert.equal(svg.type, "svg"); assert.equal(svg.props.width, 24); assert.equal(svg.props.height, 24);
  assert.ok(svg.props.dangerouslySetInnerHTML.__html.includes("<path"));
  for (const dispose of effects.reverse()) dispose();
  assert.equal(locale.size, 0);
});
