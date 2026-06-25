// Autonomous daemon: runs cycles forever on an interval. Survives crashes per
// cycle (errors are caught and logged, the loop continues). State persists in
// the Store between cycles. Stop with SIGINT/SIGTERM.

import { resolve } from "node:path";
import { loadConfig, ROOT } from "./config.ts";
import { runCycle } from "./cycle.ts";
import { Store } from "./store.ts";
import { applyStagedUpdate, checkAndStage, shouldCheck, touchMarker } from "./updater.ts";

export function updateMarkerPath(): string {
  return resolve(process.env.RADAR_DATA_DIR ?? resolve(ROOT, "data"), "update-check");
}

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

  // Apply any update staged by a previous run before doing work.
  if (applyStagedUpdate().applied) log({ level: "info", msg: "applied staged self-update" });

  log({ level: "info", msg: "daemon started", intervalMin: cfg.settings.intervalMinutes, tenants: cfg.tenants.length });

  while (running) {
    try {
      // Self-update: check at most once/day, stage for next restart.
      if (process.env.RADAR_NO_UPDATE !== "1" && shouldCheck(updateMarkerPath(), Date.now())) {
        touchMarker(updateMarkerPath());
        const u = await checkAndStage();
        if (u.status === "staged") log({ level: "info", msg: "self-update staged", from: u.current, to: u.latest });
      }
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
