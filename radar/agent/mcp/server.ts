// RadarPL MCP server — stdio transport (newline-delimited JSON-RPC 2.0).
// Run: node agent/mcp/server.ts   (register in your MCP host config)
// Exposes RadarPL as agent tools so Claude/Cursor/n8n can drive the pipeline.

import { createInterface } from "node:readline";
import { RpcServer } from "./protocol.ts";
import { TOOLS, callTool } from "./tools.ts";

export const SERVER_INFO = { name: "radar-mcp", version: "0.1.0" };
export const PROTOCOL_VERSION = "2024-11-05";

export function buildServer(): RpcServer {
  const rpc = new RpcServer();

  rpc.register("initialize", (params) => {
    const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
    return {
      protocolVersion: requested ?? PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    };
  });

  // Notifications (no response).
  rpc.register("notifications/initialized", () => undefined);
  rpc.register("ping", () => ({}));

  rpc.register("tools/list", () => ({ tools: TOOLS }));

  rpc.register("tools/call", async (params) => {
    const p = params as { name?: string; arguments?: unknown } | undefined;
    if (!p?.name) throw new Error("tools/call requires 'name'");
    const result = await callTool(p.name, p.arguments ?? {});
    return { content: [{ type: "text", text: result.text }], isError: result.isError ?? false };
  });

  return rpc;
}

function runStdio(): void {
  const rpc = buildServer();
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", async (line) => {
    const out = await rpc.handleLine(line);
    if (out) process.stdout.write(out + "\n");
  });
  // Log to stderr so we never corrupt the stdout JSON-RPC channel.
  process.stderr.write(`[radar-mcp] ready, ${TOOLS.length} tools\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStdio();
}
