# RadarPL — billing i plany (Stripe)

Subskrypcja steruje **realnym zachowaniem** agenta, nie tylko fakturą.

## Plany i uprawnienia

| Plan | Cena/mc | ICP | Leady/digest | Auto-approve | Dzienny outreach | Instant | API |
|---|--:|--:|--:|:--:|--:|:--:|:--:|
| TRIAL | 0 zł | 1 | 5 | ✕ | 3 | ✕ | ✕ |
| STARTER | 49 zł | 1 | 10 | ✕ | 10 | ✕ | ✕ |
| PRO | 149 zł | 3 | 25 | ✓ | 30 | ✓ | ✕ |
| AGENCY | 499 zł | 10 | 100 | ✓ | 100 | ✓ | ✓ |

Definicje: `agent/billing.ts` (`PLANS`). Plan tenanta ustawiasz w
`config/tenants.json` (`"plan": "PRO"`) lub przez Stripe (produkcja).

## Jak plan wpływa na agenta
- **`effectiveDigestCap`** — liczba leadów w digeście ograniczona limitem planu.
- **`effectiveAutoApprove`** — auto-wysyłka tylko gdy plan pozwala (PRO+) *i* włączona w configu.
- **`effectiveDailyCap`** — dzienny limit wysyłek to sufit planu.
- **`canAddICP`** — limit liczby profili (ICP) na tenanta.

Plan jest zawsze **sufitem**: `min(konfiguracja, limit planu)`.

## Stripe (produkcja)
1. Utwórz 3 Prices w Stripe i wpisz ich id do env: `STRIPE_PRICE_STARTER/PRO/AGENCY`.
2. Ustaw `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`.
3. Endpointy:
   - `POST /api/stripe/checkout` `{tenantId, plan}` → URL Checkout (mode: subscription).
   - `POST /api/stripe/webhook` → weryfikacja podpisu + zmiana planu/statusu tenanta.
4. Mapowanie zdarzeń Stripe → zmiana planu: `mapStripeEvent()` (czyste, testowane):
   - `checkout.session.completed` → ACTIVE + plan z price,
   - `customer.subscription.updated` → plan + status (active/past_due/canceled),
   - `customer.subscription.deleted` → CHURNED (TRIAL),
   - `invoice.payment_failed` → PAUSED.

> Route'y to cienka warstwa I/O; cała logika decyzyjna jest w `agent/billing.ts`
> i pokryta testami (`agent/test/billing.test.ts`), więc działa identycznie w
> trybie agenta (file) i web (Postgres).
