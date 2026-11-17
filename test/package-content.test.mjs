import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("every published Host relative import is present in the package allowlist", () => {
  const included = new Set(pkg.files);
  const isIncluded = (name) => included.has(name)
    || included.has("src/*.mjs") && name.startsWith("src/") && name.endsWith(".mjs");
  const visit = (name, visited = new Set()) => {
    if (visited.has(name)) return;
    visited.add(name);
    assert.ok(isIncluded(name), "Host dependency is not packaged: " + name);
    assert.ok(existsSync(resolve(root, name)), "Host dependency does not exist: " + name);
    const code = readFileSync(resolve(root, name), "utf8");
    for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*["'](\.[^"']+)["']/g)) {
      const file = relative(root, resolve(dirname(resolve(root, name)), match[1])).replaceAll("\\", "/");
      assert.ok(!file.startsWith("../"), "Host dependency escapes package");
      visit(file, visited);
    }
  };
  visit(pkg.main.replace(/^\.\//, ""));
});

test("manifest and lockfile declare the Settings API runtime requirement consistently", () => {
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  assert.equal(pkg.engines.dsh, "^0.2.2-rc.1");
  assert.deepEqual(lock.packages[""].engines, pkg.engines);
});

test("the release version, lockfile and checked-in candidate notes agree", () => {
  const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  const notes = readFileSync(resolve(root, "docs/releases", `${pkg.version}.md`), "utf8");
  assert.ok(notes.startsWith(`# ${pkg.version} `));
  assert.ok(notes.includes(`${pkg.name}-${pkg.version}.tgz`));
});
