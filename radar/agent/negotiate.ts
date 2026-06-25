// Deterministic negotiation engine. When a client counter-offers, decide
// whether to accept, counter, or walk away — maximizing expected value while
// never selling below a margin floor. Concession is monotonic by round (we give
// more ground the longer it runs), and the chance the client accepts our
// counter is modeled with a small logistic, tilted by our historical
// negotiation success. No LLM, no randomness: same inputs → same advice.

export interface NegotiationConfig {
  /** Minimum gross margin we will accept (price floor = cost / (1 - minMargin)). */
  minMargin: number;
  /** Offers within this fraction of our target are accepted outright. */
  acceptThreshold: number;
  /** Per-round concession fractions toward the client's offer (index = round-1). */
  concession: number[];
  /** Probability the client walks away entirely if we counter and they decline. */
  walkAway: number;
}

export const DEFAULT_NEGOTIATION: NegotiationConfig = {
  minMargin: 0.35,
  acceptThreshold: 0.97,
  concession: [0.2, 0.4, 0.6, 0.85],
  walkAway: 0.2,
};

export interface NegotiationInput {
  ourPrice: number; // our target / recommended price
  clientOffer: number; // what the client just proposed
  cost: number; // our cost to deliver
  round?: number; // 1-based negotiation round (default 1)
  histWinRate?: number; // historical negotiation success 0..1 (default 0.5)
  config?: Partial<NegotiationConfig>;
}

export interface NegotiationDecision {
  action: "accept" | "counter" | "decline";
  price: number; // price we accept at, or counter with (0 if decline)
  acceptProbability: number; // P(client accepts our counter), 0 for accept/decline
  expectedValue: number; // EV of the chosen action
  floor: number; // the margin floor used
  rationale: string;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Lowest price that still meets the minimum margin. */
export function floorPrice(cost: number, minMargin: number): number {
  const m = Math.min(0.95, Math.max(0, minMargin));
  return Math.round(cost / (1 - m));
}

/**
 * P(client accepts our counter). askFraction = how far we hold toward our
 * target (0 = we meet their offer, 1 = we hold firm at our price). Higher ask →
 * lower acceptance; a strong negotiation history nudges it up.
 */
export function acceptProbability(counterPrice: number, clientOffer: number, ourPrice: number, histWinRate = 0.5): number {
  const gap = ourPrice - clientOffer;
  const askFraction = gap > 0 ? Math.min(1, Math.max(0, (counterPrice - clientOffer) / gap)) : 0;
  const z = 1.4 - 2.6 * askFraction + 1.2 * (histWinRate - 0.5);
  return Math.round(sigmoid(z) * 1000) / 1000;
}

/** Recommend accept / counter / decline for a single negotiation round. */
export function negotiate(input: NegotiationInput): NegotiationDecision {
  const cfg = { ...DEFAULT_NEGOTIATION, ...input.config };
  const round = Math.max(1, input.round ?? 1);
  const histWinRate = input.histWinRate ?? 0.5;
  const { ourPrice, clientOffer, cost } = input;
  const floor = floorPrice(cost, cfg.minMargin);

  // 1) Close to (or above) target — take it, no haggling over pennies.
  if (clientOffer >= ourPrice * cfg.acceptThreshold) {
    return { action: "accept", price: clientOffer, acceptProbability: 0, expectedValue: clientOffer - cost, floor, rationale: "Oferta na poziomie celu — akceptuj." };
  }

  // 2) Build this round's counter via monotonic concession, clamped to the floor.
  const c = cfg.concession[Math.min(round - 1, cfg.concession.length - 1)] ?? 0.85;
  const rawCounter = ourPrice - c * (ourPrice - clientOffer);
  const counterPrice = Math.round(Math.max(rawCounter, floor));

  // 3) Expected values of the live options.
  const evAcceptNow = clientOffer - cost; // selling at their offer
  const pAccept = acceptProbability(counterPrice, clientOffer, ourPrice, histWinRate);
  // If they reject our counter, we assume we can still fall back to their offer,
  // unless they walk away entirely.
  const fallback = clientOffer >= cost ? (1 - cfg.walkAway) * evAcceptNow : 0;
  const evCounter = counterPrice > clientOffer
    ? Math.round(pAccept * (counterPrice - cost) + (1 - pAccept) * fallback)
    : evAcceptNow; // no room to counter above their offer with margin

  // 4) Walk away: the client sits below our cost AND is unlikely to climb to our
  // floor — chasing it burns effort for a probably-unprofitable deal.
  if (clientOffer < cost && clientOffer < floor && pAccept < 0.5) {
    return { action: "decline", price: 0, acceptProbability: pAccept, expectedValue: 0, floor, rationale: `Oferta poniżej kosztu (${cost}) i mało prawdopodobne dojście do progu ${floor} — odpuść.` };
  }

  // 5) Pick the higher-EV move. Counter only when it genuinely beats taking the
  // offer now AND leaves us a margin.
  if (evCounter > evAcceptNow && counterPrice > clientOffer && counterPrice >= floor) {
    return { action: "counter", price: counterPrice, acceptProbability: pAccept, expectedValue: evCounter, floor, rationale: `Kontroferta ${counterPrice} (akcept. ${Math.round(pAccept * 100)}%, EV ${evCounter} > ${evAcceptNow}).` };
  }
  if (evAcceptNow > 0) {
    return { action: "accept", price: clientOffer, acceptProbability: 0, expectedValue: evAcceptNow, floor, rationale: `Akceptuj ${clientOffer} — kontroferta nie poprawia EV.` };
  }
  return { action: "decline", price: 0, acceptProbability: 0, expectedValue: 0, floor, rationale: `Brak rentownego ruchu (floor ${floor}).` };
}
