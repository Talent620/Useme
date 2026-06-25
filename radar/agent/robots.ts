// robots.txt compliance guard. Polite crawling is non-negotiable — we only ever
// fetch paths our User-Agent is allowed to. Pure parser (testable offline) plus
// a small fetch+cache wrapper used by the live fetcher.

export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}
export interface RobotsGroup {
  agents: string[]; // lowercased UA tokens this group applies to
  rules: RobotsRule[];
}
export interface RobotsRules {
  groups: RobotsGroup[];
}

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let expectingAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share a group until a rule appears.
      if (!current || !expectingAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
        expectingAgent = true;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      if (!current) {
        current = { agents: ["*"], rules: [] };
        groups.push(current);
      }
      expectingAgent = false;
      current.rules.push({ type: field, path: value });
    }
  }
  return { groups };
}

/** Pick the most specific group for our UA (exact token match beats "*"). */
function selectGroup(rules: RobotsRules, userAgent: string): RobotsGroup | undefined {
  const ua = userAgent.toLowerCase();
  let star: RobotsGroup | undefined;
  for (const g of rules.groups) {
    for (const a of g.agents) {
      if (a === "*") star = star ?? g;
      else if (ua.includes(a)) return g; // specific UA token matched
    }
  }
  return star;
}

/**
 * Is `path` crawlable for `userAgent`? Longest-match wins; on equal length,
 * Allow beats Disallow (standard). No matching group or empty Disallow => allowed.
 */
export function isAllowed(rules: RobotsRules, userAgent: string, path: string): boolean {
  const group = selectGroup(rules, userAgent);
  if (!group) return true;
  let bestLen = -1;
  let allowed = true;
  for (const r of group.rules) {
    if (r.path === "") continue; // "Disallow:" with empty value = allow all
    if (pathMatches(r.path, path)) {
      const len = r.path.length;
      if (len > bestLen || (len === bestLen && r.type === "allow")) {
        bestLen = len;
        allowed = r.type === "allow";
      }
    }
  }
  return allowed;
}

/** Supports the `*` wildcard and `$` end-anchor used in robots paths. */
function pathMatches(pattern: string, path: string): boolean {
  if (!pattern.includes("*") && !pattern.endsWith("$")) {
    return path.startsWith(pattern);
  }
  let body = pattern;
  let anchorEnd = false;
  if (body.endsWith("$")) {
    anchorEnd = true;
    body = body.slice(0, -1);
  }
  // Escape regex specials (leaving '*' to become a wildcard), then expand '*'.
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + (anchorEnd ? "$" : "")).test(path);
}
