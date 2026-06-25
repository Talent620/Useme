// Minimal JSON-RPC 2.0 dispatcher for MCP over stdio (newline-delimited JSON).
// Zero dependencies — runs and tests under Node's native TS support. Implements
// just enough of the protocol for an MCP host (Claude/Cursor/n8n) to discover
// and call tools.

export interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

export class RpcServer {
  private handlers = new Map<string, RpcHandler>();

  register(method: string, handler: RpcHandler): this {
    this.handlers.set(method, handler);
    return this;
  }

  /** Dispatch one parsed request. Returns null for notifications (no id). */
  async dispatch(req: RpcRequest): Promise<RpcResponse | null> {
    const isNotification = req.id === undefined;
    const handler = this.handlers.get(req.method);
    if (!handler) {
      if (isNotification) return null;
      return { jsonrpc: "2.0", id: req.id ?? null, error: { code: -32601, message: `Method not found: ${req.method}` } };
    }
    try {
      const result = await handler(req.params);
      if (isNotification) return null;
      return { jsonrpc: "2.0", id: req.id ?? null, result };
    } catch (err) {
      if (isNotification) return null;
      const message = err instanceof Error ? err.message : String(err);
      return { jsonrpc: "2.0", id: req.id ?? null, error: { code: -32603, message } };
    }
  }

  /** Parse + dispatch a single line; returns a serialized response or null. */
  async handleLine(line: string): Promise<string | null> {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let req: RpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch {
      return JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const res = await this.dispatch(req);
    return res ? JSON.stringify(res) : null;
  }
}
