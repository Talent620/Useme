import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { buildServer, SERVER_INFO } from "../server.ts";
import { RpcServer } from "../protocol.ts";
import { TOOLS, callTool } from "../tools.ts";

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-mcp-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("protocol: notifications (no id) get no response", async () => {
  const rpc = new RpcServer().register("noop", () => 42);
  const res = await rpc.dispatch({ jsonrpc: "2.0", method: "noop" });
  assert.equal(res, null);
});

test("protocol: unknown method returns -32601", async () => {
  const rpc = new RpcServer();
  const res = await rpc.dispatch({ jsonrpc: "2.0", id: 1, method: "missing" });
  assert.equal(res?.error?.code, -32601);
});

test("protocol: handler error surfaces as -32603", async () => {
  const rpc = new RpcServer().register("boom", () => { throw new Error("nope"); });
  const res = await rpc.dispatch({ jsonrpc: "2.0", id: 2, method: "boom" });
  assert.equal(res?.error?.code, -32603);
  assert.match(res?.error?.message ?? "", /nope/);
});

test("initialize returns serverInfo + tools capability", async () => {
  const rpc = buildServer();
  const out = await rpc.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }));
  const res = JSON.parse(out!);
  assert.equal(res.result.serverInfo.name, SERVER_INFO.name);
  assert.ok(res.result.capabilities.tools);
});

test("tools/list exposes all RadarPL tools with schemas", async () => {
  const rpc = buildServer();
  const out = await rpc.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
  const res = JSON.parse(out!);
  assert.equal(res.result.tools.length, TOOLS.length);
  assert.ok(res.result.tools.every((t: { name: string; inputSchema: unknown }) => t.name && t.inputSchema));
  assert.ok(res.result.tools.some((t: { name: string }) => t.name === "radar_list_leads"));
});

test("tools/call radar_run_cycle then radar_list_leads via MCP", async () => {
  freshEnv();
  const rpc = buildServer();
  const cyc = JSON.parse((await rpc.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "radar_run_cycle", arguments: {} } })))!);
  assert.equal(cyc.result.isError, false);
  const payload = JSON.parse(cyc.result.content[0].text);
  assert.ok(payload.leads > 0, "cycle produced leads");

  const list = JSON.parse((await rpc.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "radar_list_leads", arguments: { tenantId: "demo-wp" } } })))!);
  const leads = JSON.parse(list.result.content[0].text);
  assert.ok(Array.isArray(leads) && leads[0].tenant === "demo-wp");
});

test("tools/call error path sets isError", async () => {
  freshEnv();
  const r = await callTool("radar_get_draft", { leadId: "nope" });
  assert.ok(r.isError);
});
