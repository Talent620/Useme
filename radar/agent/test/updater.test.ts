import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyStagedUpdate,
  assetForPlatform,
  compareSemver,
  isNewer,
  isPackaged,
  parseSemver,
  shouldCheck,
  stagedPath,
} from "../updater.ts";

test("parseSemver tolerates a leading v and extra suffix", () => {
  assert.deepEqual(parseSemver("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseSemver("0.1.0-rc1"), [0, 1, 0]);
  assert.equal(parseSemver("garbage"), null);
});

test("compareSemver / isNewer order versions", () => {
  assert.equal(compareSemver("1.2.0", "1.1.9"), 1);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.ok(isNewer("v0.2.0", "0.1.9"));
  assert.ok(!isNewer("0.1.0", "0.1.0"));
});

test("assetForPlatform picks the right binary per OS", () => {
  const assets = [
    { name: "radar-windows.exe", browser_download_url: "u1" },
    { name: "radar-linux", browser_download_url: "u2" },
    { name: "radar-macos", browser_download_url: "u3" },
  ];
  assert.equal(assetForPlatform(assets, "win32")!.name, "radar-windows.exe");
  assert.equal(assetForPlatform(assets, "linux")!.name, "radar-linux");
  assert.equal(assetForPlatform(assets, "darwin")!.name, "radar-macos");
});

test("isPackaged is false when running via node", () => {
  assert.equal(isPackaged("/usr/local/bin/node"), false);
  assert.equal(isPackaged("/opt/app/radar-linux"), true);
});

test("applyStagedUpdate swaps a staged binary atomically", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-upd-"));
  const exe = resolve(dir, "radar-linux");
  writeFileSync(exe, "OLD");
  writeFileSync(stagedPath(exe), "NEW");

  const r = applyStagedUpdate(exe);
  assert.equal(r.applied, true);
  assert.equal(readFileSync(exe, "utf8"), "NEW");
  assert.ok(!existsSync(stagedPath(exe)), "staged file consumed");
  assert.ok(existsSync(`${exe}.old`), "previous binary backed up");

  // No staged file => no-op.
  assert.equal(applyStagedUpdate(exe).applied, false);
});

test("shouldCheck throttles by marker mtime", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-mk-"));
  const marker = resolve(dir, "update-check");
  assert.equal(shouldCheck(marker, Date.now()), true); // never checked
  writeFileSync(marker, "x");
  assert.equal(shouldCheck(marker, Date.now()), false); // just checked
  assert.equal(shouldCheck(marker, Date.now() + 25 * 3600_000), true); // a day later
});
