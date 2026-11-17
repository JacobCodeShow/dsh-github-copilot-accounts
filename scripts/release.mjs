import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateReleaseManifest(pkg, lock, tag) {
  assert.match(pkg.name, /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/);
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(tag, `v${pkg.version}`, "Release tag must match the package version");
  assert.equal(pkg.name, lock.name, "Lockfile package name differs");
  assert.equal(pkg.name, lock.packages?.[""]?.name, "Lockfile root package name differs");
  assert.equal(pkg.version, lock.version, "Lockfile version differs");
  assert.equal(pkg.version, lock.packages?.[""]?.version, "Lockfile root version differs");
  assert.deepEqual(pkg.engines, lock.packages[""].engines, "Lockfile engines differ");
  assert.deepEqual(pkg.peerDependencies, lock.packages[""].peerDependencies, "Lockfile peers differ");
  return { name: pkg.name, version: pkg.version, tag };
}

export function artifactHashes(bytes) {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    shasum: createHash("sha1").update(bytes).digest("hex"),
  };
}

export function validatePackedArtifact(pkg, rows, bytes, hostFiles) {
  assert.equal(rows.length, 1, "Pack must produce exactly one tarball");
  const pack = rows[0];
  const filename = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
  assert.equal(pack.filename, filename, "Unexpected tarball filename");
  assert.equal(pack.name, pkg.name, "Packed package name differs");
  assert.equal(pack.version, pkg.version, "Packed package version differs");
  const hashes = artifactHashes(bytes);
  assert.equal(pack.integrity, hashes.integrity, "Tarball integrity differs from npm pack metadata");
  assert.equal(pack.shasum, hashes.shasum, "Tarball shasum differs from npm pack metadata");
  assert.equal(pack.size, bytes.length, "Tarball size differs from npm pack metadata");
  const files = pack.files.map(file => file.path);
  assert.equal(new Set(files).size, files.length, "Duplicate package paths");
  const allowed = new Set(["package.json", "README.md", "LICENSE", "cordis.patch.yml", "lib/client.js", ...hostFiles]);
  assert.equal(files.length, allowed.size, "Package contents differ from the release allowlist");
  for (const file of files) assert.ok(allowed.has(file), `Unexpected packaged file: ${file}`);
  for (const file of allowed) assert.ok(files.includes(file), `Missing packaged file: ${file}`);
  return { filename, ...hashes };
}

export function inspectLocalArtifact(root, metadataPath, artifactDirectory = root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const rows = JSON.parse(readFileSync(metadataPath, "utf8"));
  const expected = `${pkg.name.replace(/^@/, "").replace("/", "-")}-${pkg.version}.tgz`;
  const bytes = readFileSync(join(artifactDirectory, expected));
  const hosts = readdirSync(join(root, "src")).filter(name => name.endsWith(".mjs")).map(name => `src/${name}`);
  return { pkg, bytes, artifact: validatePackedArtifact(pkg, rows, bytes, hosts) };
}

export async function getPublishedVersion(pkg, request = fetch) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const response = await request(url, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  assert.ok(response.ok, `npm registry lookup failed: HTTP ${response.status}`);
  const published = await response.json();
  assert.equal(published.name, pkg.name, "Registry returned another package");
  assert.equal(published.version, pkg.version, "Registry returned another version");
  return published;
}

export function verifyPublishedArtifact(pkg, artifact, published) {
  assert.ok(published, "Published version is not available in the npm registry");
  assert.equal(published.name, pkg.name, "Published package name differs");
  assert.equal(published.version, pkg.version, "Published package version differs");
  assert.equal(published.dist?.integrity, artifact.integrity, "Published tarball integrity differs; do not overwrite or retag");
  assert.equal(published.dist?.shasum, artifact.shasum, "Published tarball shasum differs");
  assert.deepEqual(published.engines, pkg.engines, "Published engines differ");
  assert.deepEqual(published.peerDependencies, pkg.peerDependencies, "Published peers differ");
}

export function createGithubClient(repository, token, request = fetch) {
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(token, "GitHub token is required for release assets");
  return async (endpoint, { optional404 = false, binary = false } = {}) => {
    assert.match(endpoint, /^\/(?:releases\/(?:tags\/[^/]+|assets\/[1-9]\d*)|git\/ref\/tags\/[^/]+|git\/tags\/[a-f0-9]{40})$/, "Unexpected GitHub release endpoint");
    const response = await request(`https://api.github.com/repos/${repository}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: binary ? "application/octet-stream" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && optional404) return null;
    assert.ok(response.ok, `GitHub release lookup failed: HTTP ${response.status}`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}

export function verifyReleaseIdentity(release, tag) {
  assert.ok(release, "GitHub Release is unavailable");
  assert.equal(release.tag_name, tag, "GitHub Release tag differs");
  assert.ok(Array.isArray(release.assets), "GitHub Release assets are unavailable");
}

export async function verifyGithubTag(github, tag, commit) {
  const ref = await github(`/git/ref/tags/${encodeURIComponent(tag)}`);
  assert.equal(ref.ref, `refs/tags/${tag}`, "GitHub returned another release ref");
  let target = ref.object;
  const visited = new Set();
  for (let depth = 0; depth < 8; depth++) {
    assert.match(target?.sha ?? "", /^[a-f0-9]{40}$/, "Invalid GitHub tag target");
    if (target.type === "commit") {
      assert.equal(target.sha, commit, "GitHub release tag target differs; do not overwrite");
      return;
    }
    assert.equal(target.type, "tag", "Release tag must resolve to a commit");
    assert.ok(!visited.has(target.sha), "Cyclic GitHub annotated tag");
    visited.add(target.sha);
    target = (await github(`/git/tags/${target.sha}`)).object;
  }
  throw new Error("GitHub annotated tag chain is too deep");
}

export async function syncReleaseAssets({ repository, tag, commit, filename, bytes, notesPath }, { github, run }) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(tag.startsWith("v"), true);
  assert.match(filename, /^[A-Za-z0-9_.-]+\.tgz$/);
  const expected = new Map([
    [filename, bytes],
    [`${filename}.sha256`, Buffer.from(`${artifactHashes(bytes).sha256}  ${filename}\n`)],
  ]);
  await verifyGithubTag(github, tag, commit);
  const endpoint = `/releases/tags/${encodeURIComponent(tag)}`;
  let release = await github(endpoint, { optional404: true });
  if (release === null) {
    run(["release", "create", tag, "--repo", repository, "--target", commit, "--verify-tag", "--draft", "--prerelease", "--latest=false", "--title", tag, "--notes-file", notesPath]);
    release = await github(endpoint);
  }
  verifyReleaseIdentity(release, tag);
  if (release.draft) assert.equal(release.prerelease, true, "Draft release must remain a prerelease");
  const verifyAsset = async (asset, content) => {
    assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0, "Invalid GitHub asset identity");
    const remote = await github(`/releases/assets/${asset.id}`, { binary: true });
    assert.ok(Buffer.isBuffer(remote) && remote.equals(content), `Existing GitHub asset differs: ${asset.name}`);
  };
  for (const [name, content] of expected) {
    const existing = release.assets.filter(asset => asset.name === name);
    assert.ok(existing.length <= 1, `Duplicate release asset: ${name}`);
    if (existing.length === 1) await verifyAsset(existing[0], content);
  }
  for (const name of expected.keys()) {
    if (!release.assets.some(asset => asset.name === name)) run(["release", "upload", tag, name, "--repo", repository]);
  }
  release = await github(endpoint);
  verifyReleaseIdentity(release, tag);
  for (const [name, content] of expected) {
    const assets = release.assets.filter(asset => asset.name === name);
    assert.equal(assets.length, 1, `Missing release asset: ${name}`);
    await verifyAsset(assets[0], content);
  }
  if (release.draft) run(["release", "edit", tag, "--repo", repository, "--draft=false"]);
  return release.html_url;
}

export async function runReleaseCommand(command, metadataPath, { root = process.cwd(), env = process.env } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const release = validateReleaseManifest(pkg, lock, env.GITHUB_REF_NAME);
  const output = values => {
    assert.ok(env.GITHUB_OUTPUT, "GITHUB_OUTPUT is required");
    appendFileSync(env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
  };
  if (command === "validate") {
    output(release);
    return;
  }
  assert.ok(metadataPath, "npm pack JSON path is required");
  const local = inspectLocalArtifact(root, metadataPath);
  if (command === "artifact") {
    writeFileSync(join(root, `${local.artifact.filename}.sha256`), `${local.artifact.sha256}  ${local.artifact.filename}\n`);
    output({ filename: local.artifact.filename, integrity: local.artifact.integrity });
    return;
  }
  if (command === "registry" || command === "verify-published") {
    const published = await getPublishedVersion(pkg);
    if (published !== null || command === "verify-published") verifyPublishedArtifact(pkg, local.artifact, published);
    if (command === "registry") output({ exists: published !== null });
    return;
  }
  if (command === "github") {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const notesPath = `docs/releases/${pkg.version}.md`;
    assert.ok(readFileSync(join(root, notesPath), "utf8").trim(), "Release notes must not be empty");
    const checksum = readFileSync(join(root, `${local.artifact.filename}.sha256`), "utf8");
    assert.equal(checksum, `${local.artifact.sha256}  ${local.artifact.filename}\n`, "Local checksum file differs");
    const url = await syncReleaseAssets({ ...release, repository: env.GITHUB_REPOSITORY, commit, filename: local.artifact.filename, bytes: local.bytes, notesPath }, {
      github: createGithubClient(env.GITHUB_REPOSITORY, env.GH_TOKEN),
      run: args => execFileSync("gh", args, { cwd: root, env, stdio: "inherit" }),
    });
    assert.ok(/^https:\/\/github\.com\/[^\s]+$/.test(url), "Unexpected Release URL");
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
      `## Candidate release\n\n[${release.tag}](${url})\n\nAssets: ${local.artifact.filename} and ${local.artifact.filename}.sha256\n\nSHA-256: ${local.artifact.sha256}\n`);
    return;
  }
  throw new Error(`Unknown release command: ${command}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runReleaseCommand(process.argv[2], process.argv[3]);
}
