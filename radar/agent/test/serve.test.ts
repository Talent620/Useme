import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";

import { buildServer } from "../serve.ts";

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-serve-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
}

async function withServer(fn: (base: string) => Promise<void>) {
  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("dashboard HTML is served at /", async () => {
  freshEnv();
  await withServer(async (base) => {
    const html = await fetch(base + "/").then((r) => r.text());
    assert.match(html, /RadarPL/);
    assert.match(html, /RÓB ZA MNIE/);
  });
});

test("/api/state returns the full operator state", async () => {
  freshEnv();
  await withServer(async (base) => {
    const s = await fetch(base + "/api/state").then((r) => r.json());
    assert.ok(s.version);
    assert.ok(s.stats && s.pnl && Array.isArray(s.leads) && Array.isArray(s.deliverables));
  });
});

test("POST /api/auto runs a cycle and produces leads", async () => {
  freshEnv();
  await withServer(async (base) => {
    const r = await fetch(base + "/api/auto", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((x) => x.json());
    assert.equal(r.ok, true);
    assert.ok(r.leads > 0, "cycle created leads");
    const s = await fetch(base + "/api/state").then((x) => x.json());
    assert.ok(s.leads.length > 0);
  });
});

test("unknown API endpoint returns 404 JSON", async () => {
  freshEnv();
  await withServer(async (base) => {
    const r = await fetch(base + "/api/nope", { method: "POST", body: "{}" });
    assert.equal(r.status, 404);
  });
});
