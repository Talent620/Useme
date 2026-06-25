import { test } from "node:test";
import assert from "node:assert/strict";

import { isAllowed, parseRobots } from "../robots.ts";
import { RateLimiter, hostOf } from "../ratelimit.ts";

const ROBOTS = `
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /private
Allow: /private/public
Disallow: /tmp/

User-agent: RadarPL
Disallow: /secret
`;

test("parseRobots groups rules by user-agent", () => {
  const r = parseRobots(ROBOTS);
  assert.equal(r.groups.length, 3);
  assert.ok(r.groups.some((g) => g.agents.includes("radarpl")));
});

test("isAllowed: our UA-specific group is honored", () => {
  const r = parseRobots(ROBOTS);
  assert.equal(isAllowed(r, "RadarPL/0.1", "/secret/x"), false);
  assert.equal(isAllowed(r, "RadarPL/0.1", "/jobs/feed"), true);
});

test("isAllowed: wildcard group with Allow override (longest match wins)", () => {
  const r = parseRobots(ROBOTS);
  // No RadarPL rule for /private -> falls to RadarPL group which has none there,
  // but selectGroup returns the specific RadarPL group; it has no /private rule
  // so it's allowed. Verify the '*' semantics on a UA without its own group:
  assert.equal(isAllowed(r, "SomeOtherBot/1.0", "/private/secret"), false);
  assert.equal(isAllowed(r, "SomeOtherBot/1.0", "/private/public/x"), true);
});

test("isAllowed: empty disallow means allow all", () => {
  const r = parseRobots("User-agent: *\nDisallow:");
  assert.equal(isAllowed(r, "RadarPL", "/anything"), true);
});

test("isAllowed: wildcard and end-anchor patterns", () => {
  const r = parseRobots("User-agent: *\nDisallow: /*.pdf$");
  assert.equal(isAllowed(r, "X", "/files/report.pdf"), false);
  assert.equal(isAllowed(r, "X", "/files/report.html"), true);
});

test("RateLimiter enforces a minimum per-host delay", () => {
  const rl = new RateLimiter(1500);
  assert.equal(rl.delayFor("a.com", 1000), 0); // first hit, no wait
  rl.record("a.com", 1000);
  assert.equal(rl.delayFor("a.com", 1500), 1000); // 500ms elapsed, 1000 left
  assert.equal(rl.delayFor("b.com", 1500), 0); // different host unaffected
  assert.equal(rl.delayFor("a.com", 3000), 0); // enough time passed
});

test("hostOf extracts host, tolerates junk", () => {
  assert.equal(hostOf("https://useme.com/pl/jobs/feed/"), "useme.com");
  assert.equal(hostOf("not a url"), "not a url");
});
