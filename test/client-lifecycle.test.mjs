import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import * as recovery from "../src/avatar-recovery.mjs";
import * as usageSummary from "../src/usage-summary.mjs";

// Exercise the real plugin entry and badge renderer with synthetic services.
async function subject(initialState = [], globals = {}) {
  const source = await readFile(new URL("../src/client.jsx", import.meta.url), "utf8");
  const built = await build({ stdin: { contents: source + "\nexport { CopilotBadge as testBadge, openCopilotSettings };", loader: "jsx" },
    format: "cjs", platform: "browser", jsx: "automatic", write: false, logLevel: "silent" });
  const element = (type, props) => ({ type, props });
  const exports = {};
  const context = { module: { exports }, exports, console: { log() {}, warn() {} }, ...globals, require(name) {
    if (name === "react") return {
      useState: (initial) => [initialState.length > 0 ? initialState.shift() : typeof initial === "function" ? initial() : initial, () => {}],
      useEffect() {}, useRef: (initial) => ({ current: initial ?? null }),
    };
    if (name === "react-dom") return { createPortal: (node) => node };
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "fragment" };
    if (name === "./avatar-recovery.mjs") return recovery;
    if (name === "./usage-summary.mjs") return usageSummary;
    throw new Error("Unexpected client dependency");
  } };
  vm.runInNewContext(built.outputFiles[0].text, context, { timeout: 5000 });
  return context.module.exports;
}
function fixture() {
  const dictionaries = new Map(), slots = new Map();
  const locale = {
    register(namespace, values) {
      if (dictionaries.has(namespace)) throw new Error("duplicate locale");
      dictionaries.set(namespace, values);
      return () => { if (dictionaries.get(namespace) === values) dictionaries.delete(namespace); };
    },
    bind: (namespace) => (key) => dictionaries.get(namespace)?.en[key] ?? key,
  };
  function owner(failSlot = false) {
    const effects = [];
    const ctx = { locale, effect: (fn) => { const release = fn(); effects.push(release); return release; },
      slots: {
        inject: (_name, fn) => ctx.effect(fn),
        register(meta, component) {
          if (failSlot) throw new Error("synthetic slot failure");
          const key = meta.name + "/" + meta.id;
          assert.equal(slots.has(key), false); slots.set(key, { meta, component });
          return () => slots.delete(key);
        },
      } };
    return { ctx, dispose() { for (const release of effects.splice(0).reverse()) release?.(); } };
  }
  return { owner, locale, dictionaries, slots };
}
test("client apply/dispose/remount releases locale and both public slot registrations", async () => {
  const client = await subject(), f = fixture();
  for (let i = 0; i < 3; i++) {
    const instance = f.owner(); client.apply(instance.ctx);
    assert.equal(f.dictionaries.size, 1); assert.equal(f.slots.size, 3);
    instance.dispose(); assert.equal(f.dictionaries.size, 0); assert.equal(f.slots.size, 0);
  }
});
test("partial client startup failure releases its locale on owner disposal", async () => {
  const client = await subject(), f = fixture(), broken = f.owner(true);
  assert.throws(() => client.apply(broken.ctx), /synthetic slot failure/);
  broken.dispose(); assert.equal(f.dictionaries.size, 0);
  const next = f.owner(); assert.doesNotThrow(() => client.apply(next.ctx)); next.dispose();
});
test("another live locale owner is not swallowed or deleted on failed registration", async () => {
  const client = await subject(), f = fixture(), first = f.owner(), duplicate = f.owner();
  client.apply(first.ctx); assert.throws(() => client.apply(duplicate.ctx), /duplicate locale/);
  duplicate.dispose(); assert.equal(f.dictionaries.size, 1); assert.equal(f.slots.size, 3);
  first.dispose(); assert.equal(f.dictionaries.size, 0);
});

test("legacy dock visibly labels global quota instead of presenting it as Session-bound", async () => {
  const client = await subject([{ configured: true, login: "fixture", usagePercent: 25 }, [], false, null]);
  const tree = client.testBadge({ t: (key) => ({ badgeGlobalDefault: "GLOBAL_DEFAULT", badgeGlobalHint: "GLOBAL_ONLY_NOT_SESSION" }[key] ?? key) });
  const text = JSON.stringify(tree);
  assert.ok(text.includes("GLOBAL_DEFAULT")); assert.ok(text.includes("GLOBAL_ONLY_NOT_SESSION"));
});

function navigationFixture({ panelOpen = false, menuOpen = false, language = "zh" } = {}) {
  const clicks = [];
  const visible = new Set();
  const button = (text, label, name, onClick) => ({
    textContent: text,
    closest: () => null,
    ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: visible.has(name) ? "visible" : "hidden" }) } },
    getBoundingClientRect: () => ({ width: 40, height: 24 }),
    getAttribute: attribute => attribute === "aria-label" ? label : attribute === "aria-expanded" ? String(menuOpen) : null,
    click: () => { clicks.push(name); onClick?.(); },
  });
  const unrelated = button("更多", "更多", "navigation-more");
  const toolbar = button("More", "More", "toolbar-more");
  const account = button("更多", language === "zh" ? "账号菜单" : "Account menu", "account-menu", () => { menuOpen = true; });
  const hidden = button("SettingsCtrl,", null, "measurement-copy");
  const settings = button(language === "zh" ? "设置Ctrl," : "SettingsCtrl,", null, "settings", () => { panelOpen = true; });
  const otherCopilot = button("Copilot Models", null, "other-copilot-section");
  const copilot = button(language === "zh" ? "Copilot 账号" : "Copilot Accounts", null, "copilot");
  const panel = { ...button("", null, "panel"), querySelectorAll: () => [otherCopilot, copilot] };
  for (const name of ["navigation-more", "toolbar-more", "account-menu", "settings", "other-copilot-section", "copilot", "panel"]) visible.add(name);
  const document = { querySelectorAll: selector => {
    if (selector === 'button[aria-haspopup="menu"]') return [unrelated, toolbar, account];
    if (selector === '[role="menu"] [role="menuitem"]') return menuOpen ? [hidden, settings] : [];
    if (selector === '[data-shortcut-modal="settings"][role="dialog"]') return panelOpen ? [panel] : [];
    throw new Error("Unexpected navigation selector: " + selector);
  } };
  return { clicks, document };
}
for (const language of ["en", "zh"]) test(`${language}: settings jump ignores other More buttons and hidden menu copies`, async () => {
  const fixture = navigationFixture({ language });
  const client = await subject([], { document: fixture.document });
  await client.openCopilotSettings();
  assert.deepEqual(fixture.clicks, ["account-menu", "settings", "copilot"]);
});
test("settings jump selects the account section without reopening an existing settings dialog", async () => {
  const fixture = navigationFixture({ panelOpen: true });
  const client = await subject([], { document: fixture.document });
  await client.openCopilotSettings();
  assert.deepEqual(fixture.clicks, ["copilot"]);
});
test("settings jump does not toggle an already open account menu closed", async () => {
  const fixture = navigationFixture({ menuOpen: true });
  const client = await subject([], { document: fixture.document });
  await client.openCopilotSettings();
  assert.deepEqual(fixture.clicks, ["settings", "copilot"]);
});
