import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const src = resolve(root, "src");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("every distributed Host module relative import remains inside included source files", () => {
  const files = readdirSync(src).filter((name) => name.endsWith(".mjs"));
  const included = new Set(files.map((name) => resolve(src, name)));
  for (const name of files) {
    const path = resolve(src, name), code = readFileSync(path, "utf8");
    const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*["'](\.[^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of imports) {
      const target = resolve(dirname(path), specifier), inRoot = relative(root, target);
      assert.ok(!inRoot.startsWith(".." + sep), "module import must not escape package: " + name);
      assert.ok(existsSync(target), "missing relative module: " + name + " -> " + specifier);
      assert.ok(included.has(target), "source module not included by src/*.mjs: " + name + " -> " + specifier);
    }
  }
});

test("published entrypoints import without any running app or credential service", async () => {
  for (const key of [".", "./default-model"]) {
    const target = manifest.exports[key];
    assert.equal(typeof target, "string");
    const module = await import(new URL("../" + target, import.meta.url));
    assert.equal(typeof module.apply, "function", "entry must export normative plugin apply: " + key);
  }
});
