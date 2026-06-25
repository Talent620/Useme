// Built-in operator dashboard — a clean web UI served straight from the binary
// (no Next.js, zero deps, pure node:http). Live auto-refresh, one-button "do it
// for me", per-lead execute, approve/send, and a self-update button. Bind to
// localhost by default; optional token for remote use.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.ts";
import { runCycle } from "./cycle.ts";
import { runExecuteLead, runReport, runSend } from "./actions.ts";
import { computeFunnel } from "./strategy.ts";
import { forecast } from "./forecast.ts";
import { Store } from "./store.ts";
import { storePath } from "./daemon.ts";
import { VERSION } from "./version.ts";
import { applyStagedUpdate, checkAndStage } from "./updater.ts";
import { DASHBOARD_HTML } from "./dashboard.ts";

function json(res: ServerResponse, code: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-radar-token" });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); }
    });
  });
}

function buildState() {
  const store = new Store(storePath());
  const cfg = loadConfig();
  const funnel = computeFunnel(store.leadFacts());
  const fc = forecast(store.leadTimeline().map((e) => ({ key: e.category, date: e.date })));
  const leads = cfg.tenants.flatMap((t) => store.leadsForTenant(t.id, 0).slice(0, 8).map((l) => ({
    id: l.id, tenant: t.id, score: l.score, title: l.signalTitle, budget: l.signalBudget,
    status: l.status, outreach: l.outreachStatus ?? "none", executed: Boolean(l.executionStatus),
  }))).sort((a, b) => b.score - a.score).slice(0, 30);
  return {
    version: VERSION,
    now: new Date().toISOString(),
    stats: store.stats(),
    pnl: { totals: funnel.totals, byCategory: funnel.byCategory.slice(0, 6) },
    forecast: fc.slice(0, 6).map((f) => ({ key: f.key, trend: f.trend, momentum: f.momentum, predictedNext: f.predictedNext })),
    outbox: store.outbox().map((l) => ({ id: l.id, score: l.score, title: l.signalTitle, status: l.outreachStatus })),
    deliverables: store.deliverables(),
    leads,
  };
}

export function buildServer() {
  const token = process.env.RADAR_SERVE_TOKEN;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (token && url.pathname.startsWith("/api/") && req.headers["x-radar-token"] !== token) {
      return json(res, 401, { error: "unauthorized" });
    }

    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(DASHBOARD_HTML);
      }
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, buildState());

      if (req.method === "GET" && url.pathname === "/api/deliverable") {
        const store = new Store(storePath());
        const d = store.deliverables().find((x) => x.id === url.searchParams.get("id"));
        if (!d?.ref) return json(res, 404, { error: "not found" });
        const { readFileSync } = await import("node:fs");
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        return res.end(readFileSync(d.ref, "utf8"));
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        const store = new Store(storePath());
        const cfg = loadConfig();
        switch (url.pathname) {
          case "/api/auto": {
            const m = await runCycle(store, cfg, Date.now());
            runReport(store, cfg, new Date().toISOString());
            return json(res, 200, { ok: true, newSignals: m.newSignals, leads: m.leadsCreated, executed: m.executed });
          }
          case "/api/work": {
            const item = await runExecuteLead(store, cfg, String(body.leadId ?? ""));
            return json(res, item ? 200 : 404, item ?? { error: "not found" });
          }
          case "/api/approve": {
            const id = String(body.leadId ?? "");
            if (id === "all") { for (const l of store.outbox("queued")) store.setOutreach(l.id, "approved"); }
            else store.setOutreach(id, "approved");
            return json(res, 200, { ok: true });
          }
          case "/api/reject": store.setOutreach(String(body.leadId ?? ""), "skipped"); return json(res, 200, { ok: true });
          case "/api/send": return json(res, 200, await runSend(store, cfg));
          case "/api/mark": { store.setLeadStatus(String(body.leadId ?? ""), String(body.status ?? "") as never); return json(res, 200, { ok: true }); }
          case "/api/mark-exec": return json(res, 200, { ok: store.recordExecutionOutcome(String(body.leadId ?? ""), String(body.outcome ?? "") as never) });
          case "/api/update": {
            const r = await checkAndStage(undefined, true);
            const applied = r.status === "staged" ? applyStagedUpdate().applied : false;
            return json(res, 200, { ...r, applied });
          }
          default: return json(res, 404, { error: "unknown endpoint" });
        }
      }
      return json(res, 404, { error: "not found" });
    } catch (err) {
      return json(res, 500, { error: (err as Error).message });
    }
  });
}

export function serve(port = Number(process.env.RADAR_SERVE_PORT ?? "7777"), host = process.env.RADAR_SERVE_HOST ?? "127.0.0.1") {
  const server = buildServer();
  server.listen(port, host, () => {
    console.log(`RadarPL dashboard → http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) serve();
