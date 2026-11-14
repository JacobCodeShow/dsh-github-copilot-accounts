import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationLink, openVerificationLink } from "../src/external-link.mjs";

test("OAuth verification opener validates issuer URL and rejects shell/control/userinfo payloads", () => {
  assert.equal(verificationLink("https://github.com/login/device"), "https://github.com/login/device");
  assert.equal(verificationLink("https://company.ghe.com/login/device"), "https://company.ghe.com/login/device");
  for (const value of ["http://github.com/login/device", "https://evil.invalid", "https://github.com.evil.invalid", "https://user:PRIVATE@github.com", "https://github.com:444", 'https://github.com/"&echo PRIVATE', "https://github.com/\nPRIVATE", "file:///x", "https://company.ghe.com`PRIVATE"]) {
    assert.throws(() => verificationLink(value), (error) => !error.message.includes("PRIVATE") && !error.cause);
  }
});

test("OS opener never constructs a shell command; URL remains a single argv value", async () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const calls = [];
    await openVerificationLink("https://company.ghe.com/login/device?user_code=FAKE-CODE", {
      platform, windowsRoot: "C:\\Windows", run(file, args, options, done) { calls.push({file,args,options}); done(); },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].args.at(-1), "https://company.ghe.com/login/device?user_code=FAKE-CODE");
    assert.ok(!calls[0].file.includes("cmd.exe"));
  }
});

test("unknown OS launch errors never expose raw URL, arguments or exception diagnostics", async () => {
  await assert.rejects(openVerificationLink("https://github.com/login/device", {
    platform: "linux", run(_file, _args, _options, done) { done(new Error("PRIVATE_DIAGNOSTIC")); },
  }), (error) => error.code === "VERIFICATION_LINK_FAILED" && !error.message.includes("PRIVATE") && !error.cause);
});
