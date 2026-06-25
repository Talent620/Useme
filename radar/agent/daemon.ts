// Autonomous daemon: runs cycles forever on an interval. Survives crashes per
// cycle (errors are caught and logged, the loop continues). State persists in
// the Store between cycles. Stop with SIGINT/SIGTERM.

import { resolve } from "node:path";
import { loadConfig, ROOT } from "./config.ts";
import { runCycle } from "./cycle.ts";
import { Store } from "./store.ts";

function log(obj: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
}

export function storePath(): string {
  return process.env.RADAR_STORE ?? resolve(process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data"), "store.json");
}

export async function loop(): Promise<void> {
  const cfg = loadConfig();
  const store = new Store(storePath());
  const intervalMs = Math.max(1, cfg.settings.intervalMinutes) * 60_000;
  let running = true;

  const stop = (sig: string) => {
    log({ level: "info", msg: `received ${sig}, shutting down after current cycle` });
    running = false;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  log({ level: "info", msg: "daemon started", intervalMin: cfg.settings.intervalMinutes, tenants: cfg.tenants.length });

  while (running) {
    try {
      const m = await runCycle(store, loadConfig(), Date.now());
      log({ level: "info", msg: "cycle done", newSignals: m.newSignals, leads: m.leadsCreated, digests: m.digests.length, ms: m.durationMs });
    } catch (err) {
      log({ level: "error", msg: "cycle failed", error: (err as Error).message });
    }
    if (!running) break;
    await sleep(intervalMs, () => running);
  }
  log({ level: "info", msg: "daemon stopped" });
}

function sleep(ms: number, stillRunning: () => boolean): Promise<void> {
  // Wake every second so SIGINT during a long interval shuts down promptly.
  return new Promise((res) => {
    let elapsed = 0;
    const tick = setInterval(() => {
      elapsed += 1000;
      if (elapsed >= ms || !stillRunning()) {
        clearInterval(tick);
        res();
      }
    }, 1000);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loop().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
