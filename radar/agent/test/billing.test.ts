import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PLANS,
  canAddICP,
  effectiveAutoApprove,
  effectiveDailyCap,
  effectiveDigestCap,
  entitlements,
  mapStripeEvent,
  planFromPriceId,
  type Plan,
} from "../billing.ts";

test("entitlements default to STARTER and plans are coherent", () => {
  assert.equal(entitlements(undefined).plan, "STARTER");
  assert.equal(PLANS.AGENCY.apiAccess, true);
  assert.equal(PLANS.TRIAL.autoApproveAllowed, false);
  assert.ok(PLANS.PRO.maxLeadsPerDigest > PLANS.STARTER.maxLeadsPerDigest);
});

test("effectiveAutoApprove requires plan permission AND request", () => {
  assert.equal(effectiveAutoApprove("PRO", true), true);
  assert.equal(effectiveAutoApprove("PRO", false), false);
  assert.equal(effectiveAutoApprove("STARTER", true), false);
});

test("plan caps are ceilings (min of configured and plan)", () => {
  assert.equal(effectiveDigestCap("STARTER", 15), 10); // plan limits to 10
  assert.equal(effectiveDigestCap("AGENCY", 15), 15); // config is smaller
  assert.equal(effectiveDailyCap("TRIAL", 50), 3);
});

test("canAddICP enforces per-plan ICP limit", () => {
  assert.equal(canAddICP("STARTER", 0), true);
  assert.equal(canAddICP("STARTER", 1), false);
  assert.equal(canAddICP("AGENCY", 9), true);
});

const PRICE_MAP: Record<string, Plan> = { price_starter: "STARTER", price_pro: "PRO", price_agency: "AGENCY" };

test("planFromPriceId maps via configured map", () => {
  assert.equal(planFromPriceId("price_pro", PRICE_MAP), "PRO");
  assert.equal(planFromPriceId("unknown", PRICE_MAP), undefined);
});

test("mapStripeEvent: checkout completed -> ACTIVE with plan", () => {
  const change = mapStripeEvent(
    { type: "checkout.session.completed", data: { object: { customer: "cus_1", subscription: "sub_1", line_items: { data: [{ price: { id: "price_pro" } }] } } } },
    PRICE_MAP,
  );
  assert.equal(change?.plan, "PRO");
  assert.equal(change?.status, "ACTIVE");
  assert.equal(change?.customerId, "cus_1");
});

test("mapStripeEvent: subscription updated reads status + price", () => {
  const change = mapStripeEvent(
    { type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "past_due", items: { data: [{ price: { id: "price_agency" } }] } } } },
    PRICE_MAP,
  );
  assert.equal(change?.plan, "AGENCY");
  assert.equal(change?.status, "PAUSED");
});

test("mapStripeEvent: deletion churns to TRIAL; unknown -> null", () => {
  const del = mapStripeEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1" } } }, PRICE_MAP);
  assert.equal(del?.plan, "TRIAL");
  assert.equal(del?.status, "CHURNED");
  assert.equal(mapStripeEvent({ type: "ping", data: { object: {} } }, PRICE_MAP), null);
});

test("mapStripeEvent: payment failed -> PAUSED", () => {
  const f = mapStripeEvent({ type: "invoice.payment_failed", data: { object: { customer: "cus_1" } } }, PRICE_MAP);
  assert.equal(f?.status, "PAUSED");
});
