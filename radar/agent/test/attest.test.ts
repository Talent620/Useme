// Proof-of-Outcome: verification by deterministic re-execution. The result is
// the proof — anyone can replay (artifact, spec) and confirm it, or detect any
// tampering with the work or the attestation. No trust in the issuer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { attest, replay, canonicalHash, canonicalize, generateKeyPair, signAttestation, verifyAttestation } from "../attest.ts";
import { runAttest, runVerifyAttestation, deliverableSpecV1 } from "../actions.ts";
import { Store } from "../store.ts";

const spec = async (data: { x: number; y: number }) => data.x + data.y;

function freshEnv() {
  const dir = mkdtempSync(resolve(tmpdir(), "radar-attest-"));
  process.env.RADAR_DATA_DIR = dir;
  process.env.RADAR_STORE = resolve(dir, "store.json");
  return dir;
}

test("canonicalize is deep and key-order independent (the shallow-sort fix)", () => {
  const a = { b: { d: 1, c: 2 }, a: [3, { z: 1, y: 2 }] };
  const b = { a: [3, { y: 2, z: 1 }], b: { c: 2, d: 1 } };
  assert.equal(canonicalize(a), canonicalize(b), "reordered nested keys hash the same");
  assert.equal(canonicalHash(a), canonicalHash(b));
  // primitives don't throw and are stable (the original sketch broke here)
  assert.equal(canonicalHash(42), canonicalHash(42));
  assert.notEqual(canonicalHash({ x: 1 }), canonicalHash({ x: 2 }));
});

test("attest records the hash triple and a verdict", async () => {
  const att = await attest({ x: 10, y: 20 }, spec, { at: 1_000 });
  assert.equal(att.version, "1.0.0");
  assert.equal(att.timestamp, 1_000, "deterministic timestamp honored");
  assert.equal(att.resultHash, canonicalHash(30));
  assert.equal(att.outcome, "pass");
});

test("replay confirms a good attestation and is independent of the issuer", async () => {
  const att = await attest({ x: 10, y: 20 }, spec, { at: 1 });
  const r = await replay(att, { x: 10, y: 20 }, spec);
  assert.ok(r.ok, "honest attestation re-verifies");
  assert.ok(r.artifactMatch && r.specMatch && r.resultMatch);
});

test("replay detects a tampered artifact", async () => {
  const att = await attest({ x: 10, y: 20 }, spec, { at: 1 });
  const r = await replay(att, { x: 10, y: 21 }, spec); // work changed
  assert.equal(r.ok, false);
  assert.equal(r.artifactMatch, false);
});

test("replay detects a tampered result hash (forged proof)", async () => {
  const att = await attest({ x: 10, y: 20 }, spec, { at: 1 });
  const forged = { ...att, resultHash: canonicalHash(999) }; // claim a different result
  const r = await replay(forged, { x: 10, y: 20 }, spec);
  assert.equal(r.resultMatch, false);
  assert.equal(r.ok, false);
});

test("replay detects spec drift (a different verification was used)", async () => {
  const att = await attest({ x: 10, y: 20 }, spec, { at: 1 });
  const otherSpec = async (d: { x: number; y: number }) => d.x * d.y;
  const r = await replay(att, { x: 10, y: 20 }, otherSpec);
  assert.equal(r.specMatch, false);
  assert.equal(r.ok, false);
});

test("optional Ed25519 signing proves authorship; tampering invalidates it", async () => {
  const { privateKey } = generateKeyPair();
  const att = await attest({ x: 1, y: 2 }, spec, { at: 5 });
  const signed = signAttestation(att, privateKey);
  assert.ok(verifyAttestation(signed), "valid signature verifies");
  assert.equal(verifyAttestation({ ...signed, resultHash: "deadbeef" }), false, "tampered fields break the signature");
  // unsigned attestations are still replayable — signing is optional
  const r = await replay(att, { x: 1, y: 2 }, spec);
  assert.ok(r.ok && r.signatureValid, "unsigned still verifies by replay");
});

test("deliverableSpecV1 is deterministic and rejects junk", () => {
  const good = "# Tytuł\n\n" + "Treść ".repeat(60);
  const bad = "TODO: napisać to później";
  assert.equal(deliverableSpecV1(good).pass, true);
  assert.equal(deliverableSpecV1(bad).pass, false);
  // pure → identical input, identical output
  assert.deepEqual(deliverableSpecV1(good), deliverableSpecV1(good));
});

test("end-to-end: attest a lead's deliverable, then independently verify + detect tampering", async () => {
  const dir = freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  const ref = resolve(dir, "deliverable.md");
  writeFileSync(ref, "# Audyt SEO\n\n" + "Rekomendacje i analiza. ".repeat(40));
  const lead = store.upsertLead({
    tenantId: "t", signalId: "s1", icpId: "i1", score: 80, reasons: [], matchedKeywords: [],
    createdAt: "2026-06-20T00:00:00Z", signalTitle: "Audyt", signalUrl: "http://x",
    deliverableRef: ref,
  } as never);

  const a = await runAttest(store, lead.id, 123);
  assert.ok(!("error" in a), "attestation produced");
  assert.equal((a as { outcome: string }).outcome, "pass");

  const v1 = await runVerifyAttestation(store, lead.id);
  assert.ok(!("error" in v1) && (v1 as { ok: boolean }).ok, "fresh deliverable verifies");

  // Someone edits the delivered file after the fact → verification must fail.
  writeFileSync(ref, readFileSync(ref, "utf8") + "\n\nPodmieniona treść.");
  const v2 = await runVerifyAttestation(store, lead.id);
  assert.equal((v2 as { ok: boolean }).ok, false, "tampered deliverable is caught");
  assert.equal((v2 as { artifactMatch: boolean }).artifactMatch, false);
});

test("runAttest errors cleanly when there is no deliverable", async () => {
  freshEnv();
  const store = new Store(process.env.RADAR_STORE!);
  const lead = store.upsertLead({
    tenantId: "t", signalId: "s2", icpId: "i1", score: 50, reasons: [], matchedKeywords: [],
    createdAt: "2026-06-20T00:00:00Z", signalTitle: "x", signalUrl: "http://x",
  } as never);
  const r = await runAttest(store, lead.id);
  assert.ok("error" in r, "no deliverable → error, not a crash");
});
