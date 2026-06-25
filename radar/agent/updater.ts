// Built-in self-updater. The always-on daemon checks GitHub Releases (throttled)
// and stages a newer binary; the staged update is swapped in atomically on the
// next start — so the tool updates itself every release with no user action.
//
// Pure helpers (semver, asset selection, staging paths) are unit-tested; the
// network + filesystem swap are guarded and no-op outside a packaged binary.

import { chmodSync, existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { VERSION, UPDATE_REPO } from "./version.ts";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}
export interface Release {
  tag: string;
  assets: ReleaseAsset[];
}

// --- pure helpers ------------------------------------------------------
export function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! > pb[i]! ? 1 : -1;
  }
  return 0;
}

export function isNewer(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

/** Pick the release asset matching the current OS. */
export function assetForPlatform(assets: ReleaseAsset[], platform: NodeJS.Platform = process.platform): ReleaseAsset | undefined {
  const want = platform === "win32" ? /(\.exe$|windows)/i : platform === "darwin" ? /(darwin|macos)/i : /linux/i;
  return assets.find((a) => want.test(a.name));
}

/** Is this process a packaged binary (not `node …`)? Updater only acts then. */
export function isPackaged(execPath: string = process.execPath): boolean {
  if (process.env.RADAR_FORCE_PACKAGED === "1") return true;
  const base = basename(execPath).toLowerCase();
  return base !== "node" && base !== "node.exe" && !base.startsWith("bun");
}

export function stagedPath(execPath: string = process.execPath): string {
  return `${execPath}.new`;
}
export function backupPath(execPath: string = process.execPath): string {
  return `${execPath}.old`;
}

// --- filesystem swap ---------------------------------------------------
/** Apply a previously staged update by swapping the binary. Safe to call always. */
export function applyStagedUpdate(execPath: string = process.execPath): { applied: boolean } {
  const staged = stagedPath(execPath);
  if (!existsSync(staged)) return { applied: false };
  try {
    // Windows can't delete a running exe but can rename it; do the same on all OSes.
    const old = backupPath(execPath);
    if (existsSync(old)) rmSync(old, { force: true });
    if (existsSync(execPath)) renameSync(execPath, old);
    renameSync(staged, execPath);
    try { chmodSync(execPath, 0o755); } catch { /* windows: no chmod */ }
    return { applied: true };
  } catch {
    return { applied: false };
  }
}

// --- network -----------------------------------------------------------
export async function fetchLatestRelease(repo: string = UPDATE_REPO): Promise<Release | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "RadarPL-Updater" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
    if (!data.tag_name) return null;
    return { tag: data.tag_name, assets: data.assets ?? [] };
  } catch {
    return null;
  }
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "RadarPL-Updater" }, signal: AbortSignal.timeout(120000) });
    if (!res.ok || !res.body) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

export interface UpdateResult {
  status: "staged" | "up-to-date" | "skipped" | "no-release" | "no-asset" | "download-failed";
  current: string;
  latest?: string;
}

/** Check for a newer release and stage it (no restart). Throttled by caller. */
export async function checkAndStage(repo: string = UPDATE_REPO, force = false): Promise<UpdateResult> {
  if (!force && !isPackaged()) return { status: "skipped", current: VERSION };
  const release = await fetchLatestRelease(repo);
  if (!release) return { status: "no-release", current: VERSION };
  if (!isNewer(release.tag, VERSION)) return { status: "up-to-date", current: VERSION, latest: release.tag };
  const asset = assetForPlatform(release.assets);
  if (!asset) return { status: "no-asset", current: VERSION, latest: release.tag };
  const ok = await download(asset.browser_download_url, stagedPath());
  return { status: ok ? "staged" : "download-failed", current: VERSION, latest: release.tag };
}

// --- throttle ----------------------------------------------------------
const DAY_MS = 24 * 3600_000;

export function shouldCheck(markerPath: string, now: number, intervalMs = DAY_MS): boolean {
  try {
    const mtime = statSync(markerPath).mtimeMs;
    return now - mtime >= intervalMs;
  } catch {
    return true; // never checked
  }
}

export function touchMarker(markerPath: string): void {
  try { writeFileSync(markerPath, new Date().toISOString()); } catch { /* ignore */ }
}
