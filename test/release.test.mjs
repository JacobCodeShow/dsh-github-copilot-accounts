import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { artifactHashes, createGithubClient, getPublishedVersion, runReleaseCommand, syncReleaseAssets, validatePackedArtifact, validateReleaseManifest, verifyGithubTag, verifyPublishedArtifact } from "../scripts/release.mjs";

const pkg = {
  name: "dsh-github-copilot-accounts", version: "0.3.6-dsh-0.2.2-rc.3",
  engines: { node: ">=20", dsh: "^0.2.2-rc.1" }, peerDependencies: { "@deepseek-ai/cordis": "~4.1.0" },
};
const lock = () => ({ name: pkg.name, version: pkg.version, packages: { "": structuredClone(pkg) } });
const tag = `v${pkg.version}`;
const bytes = Buffer.from("synthetic release artifact");
const hosts = ["src/host.mjs", "src/shared.mjs"];
const files = ["package.json", "README.md", "LICENSE", "cordis.patch.yml", "lib/client.js", ...hosts];
const metadata = () => [{
  name: pkg.name, version: pkg.version, filename: `${pkg.name}-${pkg.version}.tgz`, size: bytes.length,
  integrity: artifactHashes(bytes).integrity, shasum: artifactHashes(bytes).shasum,
  files: files.map(path => ({ path })),
}];

test("release tag and all manifest identities must agree", () => {
  assert.deepEqual(validateReleaseManifest(pkg, lock(), tag), { name: pkg.name, version: pkg.version, tag });
  for (const wrong of ["master", "v0.3.5", `${tag}\n`]) assert.throws(() => validateReleaseManifest(pkg, lock(), wrong));
  for (const field of ["version", "name", "engines", "peerDependencies"]) {
    const changed = lock(); changed.packages[""][field] = "different";
    assert.throws(() => validateReleaseManifest(pkg, changed, tag));
  }
  const changed = lock(); changed.version = "0.1.0";
  assert.throws(() => validateReleaseManifest(pkg, changed, tag));
});

test("release package has one verified tarball containing exactly the public package files", () => {
  const artifact = validatePackedArtifact(pkg, metadata(), bytes, hosts);
  assert.equal(artifact.filename, `${pkg.name}-${pkg.version}.tgz`);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(artifact.integrity, /^sha512-/);
});

test("release package rejects missing Host imports and leaked development or local files", () => {
  for (const removed of files) {
    const rows = metadata(); rows[0].files = rows[0].files.filter(file => file.path !== removed);
    assert.throws(() => validatePackedArtifact(pkg, rows, bytes, hosts));
  }
  for (const extra of [".npmrc", ".credentials.yaml", "test/fixture.json", "scripts/release.mjs", "../outside"]) {
    const rows = metadata(); rows[0].files.push({ path: extra });
    assert.throws(() => validatePackedArtifact(pkg, rows, bytes, hosts));
  }
});

test("release package rejects mismatched bytes, names and pack identities", () => {
  assert.throws(() => validatePackedArtifact(pkg, [], bytes, hosts));
  assert.throws(() => validatePackedArtifact(pkg, [...metadata(), ...metadata()], bytes, hosts));
  for (const field of ["name", "version", "filename", "integrity", "shasum", "size"]) {
    const rows = metadata(); rows[0][field] = "different";
    assert.throws(() => validatePackedArtifact(pkg, rows, bytes, hosts));
  }
  assert.throws(() => validatePackedArtifact(pkg, metadata(), Buffer.from("changed artifact"), hosts));
});

const published = () => ({ ...structuredClone(pkg), dist: { integrity: artifactHashes(bytes).integrity, shasum: artifactHashes(bytes).shasum } });

test("only an explicit npm HTTP 404 means a version has not been published", async () => {
  assert.equal(await getPublishedVersion(pkg, async () => new Response(null, { status: 404 })), null);
  for (const status of [401, 403, 429, 500, 503]) {
    await assert.rejects(getPublishedVersion(pkg, async () => new Response(null, { status })), /registry lookup failed/);
  }
  await assert.rejects(getPublishedVersion(pkg, async () => { throw new Error("network timeout"); }), /network timeout/);
  await assert.rejects(getPublishedVersion(pkg, async () => new Response("not json")));
});

test("registry lookup uses the exact package/version and rejects redirected metadata", async () => {
  const result = await getPublishedVersion(pkg, async (url, options) => {
    assert.equal(url, `https://registry.npmjs.org/${pkg.name}/${pkg.version}`);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(published());
  });
  assert.equal(result.version, pkg.version);
  for (const changed of [{ ...published(), name: "other-package" }, { ...published(), version: "0.1.0" }]) {
    await assert.rejects(getPublishedVersion(pkg, async () => Response.json(changed)));
  }
});

test("an existing npm version can only be reused when its bytes and declarations match", () => {
  const artifact = artifactHashes(bytes);
  verifyPublishedArtifact(pkg, artifact, published());
  assert.throws(() => verifyPublishedArtifact(pkg, artifact, null));
  for (const field of ["name", "version", "engines", "peerDependencies"]) {
    const changed = published(); changed[field] = "different";
    assert.throws(() => verifyPublishedArtifact(pkg, artifact, changed));
  }
  for (const field of ["integrity", "shasum"]) {
    const changed = published(); changed.dist[field] = "different";
    assert.throws(() => verifyPublishedArtifact(pkg, artifact, changed));
  }
});

const commit = "a".repeat(40);
const filename = `${pkg.name}-${pkg.version}.tgz`;
function githubFixture({ existing = false, draft = false, remoteCommit = commit } = {}) {
  const commands = [], contents = new Map();
  let release = existing ? { tag_name: tag, target_commitish: commit, draft, prerelease: true, assets: [], html_url: "https://github.com/example/plugin/releases/tag/" + tag } : null;
  const add = name => {
    const id = contents.size + 1;
    contents.set(id, name.endsWith(".sha256") ? Buffer.from(`${artifactHashes(bytes).sha256}  ${filename}\n`) : bytes);
    release.assets.push({ id, name });
  };
  const github = async (endpoint, options = {}) => {
    if (endpoint.startsWith("/git/ref/tags/")) return { ref: `refs/tags/${tag}`, object: { type: "commit", sha: remoteCommit } };
    if (endpoint.startsWith("/releases/assets/")) return contents.get(Number(endpoint.split("/").at(-1)));
    assert.equal(endpoint, `/releases/tags/${encodeURIComponent(tag)}`);
    if (release === null) { assert.equal(options.optional404, true); return null; }
    return structuredClone(release);
  };
  const run = args => {
    commands.push(args);
    if (args[1] === "create") release = { tag_name: tag, target_commitish: commit, draft: true, prerelease: true, assets: [], html_url: "https://github.com/example/plugin/releases/tag/" + tag };
    if (args[1] === "upload") add(args[3]);
    if (args[1] === "edit") release.draft = false;
  };
  return { github, run, commands, contents, add, get release() { return release; } };
}
const releaseOptions = () => ({ repository: "example/plugin", tag, commit, filename, bytes, notesPath: "docs/releases/candidate.md" });

test("GitHub API errors do not become missing releases or missing assets", async () => {
  assert.throws(() => createGithubClient("other/path/unsafe", "synthetic-token"));
  assert.throws(() => createGithubClient("example/plugin", ""));
  for (const status of [401, 403, 429, 500]) {
    const api = createGithubClient("example/plugin", "synthetic-token", async () => new Response(null, { status }));
    await assert.rejects(api("/releases/tags/v1", { optional404: true }));
  }
  const missing = createGithubClient("example/plugin", "synthetic-token", async () => new Response(null, { status: 404 }));
  assert.equal(await missing("/releases/tags/v1", { optional404: true }), null);
  await assert.rejects(missing("/releases/assets/1", { binary: true }));
});

test("a candidate release is published only after both immutable assets are verified", async () => {
  const fixture = githubFixture();
  const url = await syncReleaseAssets(releaseOptions(), fixture);
  assert.ok(url.endsWith(tag));
  assert.deepEqual(fixture.commands.map(args => args[1]), ["create", "upload", "upload", "edit"]);
  assert.ok(fixture.commands[0].includes("--draft"));
  assert.ok(fixture.commands[0].includes("--prerelease"));
  assert.ok(fixture.commands[0].includes("--latest=false"));
  assert.ok(fixture.commands[0].includes("--verify-tag"));
  assert.deepEqual(fixture.release.assets.map(asset => asset.name), [filename, `${filename}.sha256`]);
  assert.equal(fixture.release.draft, false);
  assert.equal(fixture.release.prerelease, true);
});

test("release retries reuse identical assets and never overwrite or demote a promoted release", async () => {
  const fixture = githubFixture({ existing: true });
  fixture.add(filename); fixture.add(`${filename}.sha256`);
  fixture.release.prerelease = false;
  fixture.release.target_commitish = "master";
  await syncReleaseAssets(releaseOptions(), fixture);
  assert.deepEqual(fixture.commands, []);
  assert.equal(fixture.release.prerelease, false);
});

test("release retries upload only missing assets and reject mismatched existing content first", async () => {
  const fixture = githubFixture({ existing: true, draft: true });
  fixture.add(filename);
  await syncReleaseAssets(releaseOptions(), fixture);
  assert.deepEqual(fixture.commands.map(args => args[1]), ["upload", "edit"]);
  assert.equal(fixture.commands[0][3], `${filename}.sha256`);
  const changed = githubFixture({ existing: true });
  changed.add(filename); changed.contents.set(1, Buffer.from("different published bytes"));
  await assert.rejects(syncReleaseAssets(releaseOptions(), changed), /Existing GitHub asset differs/);
  assert.deepEqual(changed.commands, []);
});

test("a release at another tag target or a missing uploaded asset fails closed", async () => {
  const changed = githubFixture({ existing: true, remoteCommit: "b".repeat(40) });
  await assert.rejects(syncReleaseAssets(releaseOptions(), changed), /target differs/);
  assert.deepEqual(changed.commands, []);
  const incomplete = githubFixture({ existing: true, draft: true });
  incomplete.run = args => { incomplete.commands.push(args); };
  await assert.rejects(syncReleaseAssets(releaseOptions(), incomplete), /Missing release asset/);
  assert.equal(incomplete.commands.some(args => args[1] === "edit"), false);
});

test("GitHub annotated release tags resolve to the checked-out commit", async () => {
  const tagObject = "b".repeat(40);
  const endpoints = [];
  await verifyGithubTag(async endpoint => {
    endpoints.push(endpoint);
    if (endpoint.startsWith("/git/ref/")) return { ref: `refs/tags/${tag}`, object: { type: "tag", sha: tagObject } };
    assert.equal(endpoint, `/git/tags/${tagObject}`);
    return { object: { type: "commit", sha: commit } };
  }, tag, commit);
  assert.equal(endpoints.length, 2);
  await assert.rejects(verifyGithubTag(async endpoint => endpoint.startsWith("/git/ref/")
    ? { ref: `refs/tags/${tag}`, object: { type: "tag", sha: tagObject } }
    : { object: { type: "tag", sha: tagObject } }, tag, commit), /Cyclic/);
  await assert.rejects(verifyGithubTag(async () => ({ ref: "refs/tags/another", object: { type: "commit", sha: commit } }), tag, commit), /another release ref/);
});

test("the workflow only publishes version tags to next and attaches the same verified tarball", () => {
  const workflow = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on, { push: { tags: ["v*"] } });
  assert.equal(workflow.permissions.contents, "write");
  assert.equal(workflow.permissions["id-token"], "write");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.ok(workflow.jobs.publish.if.includes("github.event.deleted == false"));
  const steps = workflow.jobs.publish.steps;
  assert.equal(steps.find(step => step.uses?.startsWith("actions/checkout@"))?.with["fetch-depth"], 0);
  const runs = steps.map(step => step.run ?? "").join("\n");
  assert.ok(runs.includes("git merge-base --is-ancestor HEAD origin/master"));
  assert.ok(runs.includes("npm pack --json --ignore-scripts"));
  assert.ok(runs.includes('npm publish "./$TARBALL" --access public --tag next'));
  assert.ok(!runs.includes("--tag latest"));
  assert.ok(runs.includes('node scripts/release.mjs verify-published "$RUNNER_TEMP/copilot-pack.json"'));
  assert.ok(runs.includes('node scripts/release.mjs github "$RUNNER_TEMP/copilot-pack.json"'));
  const publish = steps.find(step => step.name?.startsWith("Publish candidate"));
  assert.equal(publish.if, "steps.registry.outputs.exists == 'false'");
  assert.equal(publish.env.TARBALL, "${{ steps.artifact.outputs.filename }}");
});

test("workflow outputs and checksum files are written only after release validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "copilot-release-test-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock()));
    const output = join(root, "outputs");
    await runReleaseCommand("validate", undefined, { root, env: { GITHUB_REF_NAME: tag, GITHUB_OUTPUT: output } });
    assert.equal(readFileSync(output, "utf8"), `name=${pkg.name}\nversion=${pkg.version}\ntag=${tag}\n`);
    mkdirSync(join(root, "src"));
    for (const host of hosts) writeFileSync(join(root, host), "");
    writeFileSync(join(root, filename), bytes);
    const packPath = join(root, "pack.json");
    writeFileSync(packPath, JSON.stringify(metadata()));
    await runReleaseCommand("artifact", packPath, { root, env: { GITHUB_REF_NAME: tag, GITHUB_OUTPUT: output } });
    assert.equal(readFileSync(join(root, `${filename}.sha256`), "utf8"), `${artifactHashes(bytes).sha256}  ${filename}\n`);
    assert.ok(readFileSync(output, "utf8").includes(`filename=${filename}\nintegrity=${artifactHashes(bytes).integrity}\n`));
    const before = readFileSync(output, "utf8");
    await assert.rejects(runReleaseCommand("validate", undefined, { root, env: { GITHUB_REF_NAME: "v0.1.0", GITHUB_OUTPUT: output } }));
    assert.equal(readFileSync(output, "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
