# RadarPL 🛰️

> **Do pobrania (Windows `.exe` + Ubuntu + Android `.apk`) z auto-aktualizacją:** [INSTALL.md](./INSTALL.md) · [Releases](https://github.com/talent620/useme/releases/latest)


**Silnik sygnałów popytu z publicznych danych.** Z job-boardów, przetargów,
rejestrów firm i finansowań wykrywa, kto *właśnie teraz* potrzebuje usługi,
ocenia intencję zakupową 0–100 względem Twojego profilu (ICP) i dostarcza
gotowego leada z draftem pierwszej wiadomości.

Produkt **i** kanał sprzedaży w jednym: ten sam silnik znajduje klientów dla
klientów oraz dla siebie (self-targeting → CAC ≈ 0).

> Pełna strategia: [`../STRATEGY.md`](../STRATEGY.md) ·
> Architektura: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)

## Status

| Warstwa | Stan |
|---|---|
| `@radar/core` (scoring, dedup, match, draft) | ✅ działa, 12 testów |
| `@radar/worker` (ingest RSS→enrich→score) | ✅ pipeline + 2 testy |
| **`agent/` — autonomiczny cykl (crawl→score→draft→dostawa)** | ✅ **działa end-to-end, 3 testy** |
| **GitHub Actions cron (autonomia w chmurze)** | ✅ **`.github/workflows/radar-autonomous.yml`** |
| **Outreach z bramką + self-improving scoring** | ✅ **27 testów** |
| **Serwer MCP (agent-native, 10 narzędzi)** | ✅ **`agent/mcp/`, 7 testów** |
| **Realne źródła: robots/rate-limit/warunkowy GET** | ✅ **7 testów** |
| **Persystencja Postgres/Prisma (swappowalny repo)** | ✅ **3 testy + migracja** ([PERSISTENCE.md](./PERSISTENCE.md)) |
| **Billing Stripe + plany (limity w runtime)** | ✅ **9 testów** ([BILLING.md](./BILLING.md)) |
| **Samoobsługowy onboarding + proof-of-value** | ✅ **4 testy** (CLI `onboard`, MCP, `/api/signup`) |
| **🚀 Autonomiczna realizacja zleceń (silnik egzekucji)** | ✅ **8 testów** ([EXECUTION.md](./EXECUTION.md)) |
| **Perfekcyjne wykonanie: best-of-N + iteracja + repair → 100/100** | ✅ **4 testy** (refine) |
| **Narzędzia wykonawców: SEO, research z cytowaniami, workflow n8n** | ✅ **13 testów** (`exec/tools/`) |
| **Graf wielozadaniowy (automation→spec+n8n, ecommerce→landing+treści)** | ✅ |
| **Orkiestrator: dynamiczna kompozycja narzędzi + generacja obrazu** | ✅ **4 testy** (Higgsfield + fallback SVG) |
| **Samokalibracja jakości wykonania (2. pętla uczenia)** | ✅ **4 testy** (system sam podnosi poprzeczkę) |
| **Agent-CEO: P&L lejka + autonomiczna realokacja** | ✅ **4 testy** (rozwijaj/wygaś/upsell/ceny, auto-apply) |
| **Pętla predykcyjna popytu (prognoza + prealokacja)** | ✅ **6 testów** (Holt + regresja + momentum) |
| **Panel operatora (pipeline+P&L+prognoza+jakość+TODO) + live w CI** | ✅ **2 testy** (`report`) |
| **Binarki Windows/Ubuntu/Android + auto-update** | ✅ **6 testów** ([INSTALL.md](./INSTALL.md), [Releases](https://github.com/talent620/useme/releases/latest)) |
| **Panel webowy `serve` (przejrzysty UI, live, akcje)** | ✅ **4 testy** (wbudowany, zero zależności) |
| **Zaawansowana autonomia: pamięć, multi-agent, CFO, ceny, CRM, intel** | ✅ **8 testów** ([ADVANCED.md](./ADVANCED.md), [AUDIT.md](../AUDIT.md), [ROADMAP.md](../ROADMAP.md)) |
| Prisma schema / docker-compose / API / Dockerfile | ✅ scaffold |
| Live crawl + płatne plany | 🚧 włącz źródła + sekrety Stripe |

> **Tryb autonomiczny:** [`AUTONOMY.md`](./AUTONOMY.md) — agent działa za Ciebie bez Twojego komputera.

## Szybki start

```bash
# 1) Testy rdzenia — bez instalacji (Node 22 uruchamia .ts natywnie)
cd packages/core && node --test
cd ../../apps/worker && node --test

# 2) Pełny stack
cp .env.example .env          # uzupełnij OPENAI_API_KEY itd.
docker compose up -d          # postgres, redis, n8n
pnpm install
pnpm db:migrate
pnpm --filter @radar/web dev  # http://localhost:3000
```

## Architektura w 1 zdaniu

`Publiczne źródła → crawl (rate-limit/robots) → normalizacja+dedupe → enrich (AI) →
scoring (czysta funkcja, testowana) → leady w Postgres → digest/alert/outreach przez n8n`.

## Dlaczego to się obroni

- **Efekt danych:** akumulacja sygnałów + etykiet WON/LOST → scoring poprawia się z czasem.
- **Koszt integracji źródeł:** każdy adapter to bariera dla naśladowców.
- **Flywheel podaży leadów:** nadwyżkowe leady krążą między tenantami.
- **Wejście wertykalne:** najpierw nisza (PL freelancerzy WP/SEO), potem ekspansja.

## Etyka i zgodność

Tylko publiczne dane, respekt `robots.txt`/ToS, własny `User-Agent`, rate-limit,
preferencja oficjalnych feedów/API. Sygnały to oferty/zapytania biznesowe, nie
profile osób. RODO: minimalizacja danych, kasowanie kaskadowe po tenancie.
