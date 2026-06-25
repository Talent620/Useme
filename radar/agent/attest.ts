// attest.ts — Proof-of-Outcome: verification by deterministic re-execution.
//
// The thesis: don't trust the result, trust determinism. An Attestation records
// the hashes of (artifact, spec, result). Anyone can REPLAY — re-run the same
// spec over the same artifact — and confirm the same resultHash, with no need to
// trust the issuer and no central authority. Verification is intrinsic, not
// vouched. Signing is optional (authorship only); the proof is the replay.
//
// Deterministic, dependency-free (node:crypto only). Works without any key.

import { createHash, generateKeyPairSync, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

export interface Attestation {
  version: "1.0.0";
  artifactHash: string; // hash of the work/input
  specHash: string; // hash of the verification spec's source
  resultHash: string; // hash of the spec's deterministic output
  outcome: "pass" | "fail"; // did the spec accept the artifact
  timestamp: number;
  signature?: string; // optional Ed25519 signature (base64)
  publicKey?: string; // optional Ed25519 public key (PEM) so anyone can verify
}

/** A verification spec: a PURE function of the artifact. Determinism is the
 * whole contract — a spec that reads the clock, the network, or closure state
 * cannot be replayed and must not be used. */
export type Spec<A = unknown, R = unknown> = (artifact: A) => R | Promise<R>;

export interface ReplayResult {
  ok: boolean; // all checks passed → the attestation is independently confirmed
  artifactMatch: boolean;
  specMatch: boolean;
  resultMatch: boolean;
  signatureValid: boolean; // true if unsigned (not required) or a valid signature
  outcome: "pass" | "fail";
}

/** Canonical, deep, stable serialization — the fix for the shallow-sort bug.
 * Object keys are sorted at every level; primitives and arrays are handled. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

/** Deterministic SHA-256 over the canonical form of any value. */
export function canonicalHash(v: unknown): string {
  return createHash("sha256").update(canonicalize(v)).digest("hex");
}

function outcomeOf(result: unknown): "pass" | "fail" {
  if (typeof result === "boolean") return result ? "pass" : "fail";
  if (result && typeof result === "object" && "pass" in (result as Record<string, unknown>)) {
    return (result as { pass: unknown }).pass ? "pass" : "fail";
  }
  return result === undefined || result === null ? "fail" : "pass";
}

/**
 * Produce a Proof-of-Outcome: run the spec over the artifact and record the
 * hash triple + verdict. Pass `at` for a deterministic timestamp (tests/replay).
 */
export async function attest<A, R>(artifact: A, spec: Spec<A, R>, opts: { at?: number } = {}): Promise<Attestation> {
  const result = await spec(artifact);
  return {
    version: "1.0.0",
    artifactHash: canonicalHash(artifact),
    specHash: canonicalHash(spec.toString()),
    resultHash: canonicalHash(result),
    outcome: outcomeOf(result),
    timestamp: opts.at ?? Date.now(),
  };
}

/**
 * Independently verify an attestation by RE-RUNNING the spec over the artifact.
 * No trust in the issuer required — this is the load-bearing function. Returns
 * which facets matched so a verifier can see exactly what (if anything) drifted.
 */
export async function replay<A, R>(att: Attestation, artifact: A, spec: Spec<A, R>): Promise<ReplayResult> {
  const artifactMatch = canonicalHash(artifact) === att.artifactHash;
  const specMatch = canonicalHash(spec.toString()) === att.specHash;
  const result = await spec(artifact);
  const resultMatch = canonicalHash(result) === att.resultHash;
  const signatureValid = att.signature ? verifyAttestation(att) : true;
  return {
    ok: artifactMatch && specMatch && resultMatch && signatureValid,
    artifactMatch,
    specMatch,
    resultMatch,
    signatureValid,
    outcome: outcomeOf(result),
  };
}

// -- optional authorship (Ed25519) --------------------------------------------
// The proof is the replay; signing only attests WHO issued it. Entirely
// optional — the system runs with no keys.

/** The bytes an attestation's signature covers (everything but the signature). */
function signingPayload(a: Attestation): string {
  return `${a.version}|${a.artifactHash}|${a.specHash}|${a.resultHash}|${a.outcome}|${a.timestamp}`;
}

/** Generate an Ed25519 keypair (PEM). For agents/operators that want authorship. */
export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

/** Sign an attestation, embedding the public key so any verifier can check it. */
export function signAttestation(att: Attestation, privateKeyPem: string): Attestation {
  const signature = edSign(null, Buffer.from(signingPayload(att)), privateKeyPem).toString("base64");
  const publicKey = createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" }).toString();
  return { ...att, signature, publicKey };
}

/** Verify an attestation's signature. False if unsigned or tampered. */
export function verifyAttestation(att: Attestation): boolean {
  if (!att.signature || !att.publicKey) return false;
  try {
    return edVerify(null, Buffer.from(signingPayload(att)), att.publicKey, Buffer.from(att.signature, "base64"));
  } catch {
    return false;
  }
}
