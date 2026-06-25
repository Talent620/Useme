# RadarPL — architektura produkcyjna (Etap 8)

Stack: **TypeScript · Next.js · PostgreSQL · Redis · Docker · OpenAI · MCP · n8n**.

## 1. Diagram architektury

```mermaid
flowchart TB
  subgraph Public["Publiczne źródła danych"]
    JB[Job-boardy: Useme/Oferia]
    TND[Przetargi: BZP/TED]
    REG[Rejestry: CEIDG/KRS]
    FUND[Finansowania/Akceleratory]
    RSSx[RSS/Social]
  end

  subgraph Ingest["Warstwa ingestu (worker)"]
    CRAWL[Crawl adapters\nrate-limit + robots.txt]
    NORM[Normalize -> Signal\n@radar/core/sources]
    DEDUP[Dedupe\nFNV-1a dedupeKey]
  end

  subgraph AI["Agenci AI"]
    ENRICH[Enrich agent\nlang/budget/kategorie]
    SCORE[Scoring\n@radar/core/score]
    DRAFT[Proposal agent\n@radar/core/proposal + LLM]
  end

  Q[(Redis / BullMQ\nkolejki zadań)]
  DB[(PostgreSQL\nPrisma)]

  subgraph App["Aplikacja (Next.js)"]
    API[REST API\n/api/ingest /api/leads /api/health]
    DASH[Dashboard tenanta]
    BILL[Stripe billing]
  end

  subgraph Deliver["Dostarczanie"]
    N8N[n8n workflows\nscheduler + HITL approval]
    MAIL[Email/Resend]
    SLACK[Slack/Webhook]
  end

  MON[Monitoring\nOTel + logi + /health]

  Public --> CRAWL --> NORM --> DEDUP --> Q
  Q --> ENRICH --> SCORE --> DB
  SCORE --> DRAFT --> DB
  API <--> DB
  N8N --> API
  DB --> N8N --> MAIL & SLACK
  BILL <--> DB
  App -.metryki.-> MON
  Ingest -.metryki.-> MON
  AI -.metryki.-> MON
```

## 2. Struktura repozytorium

```
radar/
  package.json                # pnpm workspaces
  pnpm-workspace.yaml
  tsconfig.base.json
  docker-compose.yml          # postgres, redis, n8n, web, worker
  .env.example
  prisma/
    schema.prisma             # Tenant, Icp, Signal, Lead, Delivery, Subscription, SourceState
  packages/
    core/                     # czysta logika domenowa (0 zależności runtime, testowana)
      src/signals/            # types, dedup, score
      src/icp/                # match
      src/proposal/           # template (draft pierwszej wiadomości)
      src/sources/            # parse (budżet, język, kategorie)
      test/core.test.ts       # node --test (12 testów)
  apps/
    web/                      # Next.js (App Router): API + dashboard + billing
      app/api/{health,leads,ingest}/route.ts
      lib/db.ts               # Prisma singleton
      Dockerfile
    worker/                   # ingest -> enrich -> score -> persist
      src/{index,rss,enrich,sources}.ts
      test/rss.test.ts        # node --test (2 testy)
      Dockerfile
  n8n/                        # workflowy orkiestracji (JSON eksport + README)
```

## 3. Baza danych (PostgreSQL / Prisma)

Pełny schemat: `radar/prisma/schema.prisma`. Encje:

- **Tenant** — klient (freelancer/agencja); także my sami (dogfooding/self-targeting).
- **Icp** — reguły dopasowania (keywords, exclude, kategorie, budżet, języki, wagi źródeł).
- **Signal** — znormalizowany, zdeduplikowany sygnał (`dedupeKey @unique` → idempotencja).
- **Lead** — ocena Signal×ICP (`@@unique([tenantId, signalId, icpId])`), draft, status.
- **Delivery** — log wysyłek (audyt + zapobieganie podwójnym wysyłkom).
- **Subscription** — Stripe, plan, okres.
- **SourceState** — kursory crawla, last-run, stan rate-limitu/zdrowia źródła.

Indeksy pod gorące zapytania: `Lead(tenantId, status, score)`, `Signal(source, publishedAt)`.

## 4. Kolejki zadań (Redis / BullMQ)

- `crawl` — jeden job na źródło, cron co 15 min (n8n lub BullMQ repeatable).
- `enrich` — wywołanie LLM; współbieżność limitowana, retry z backoff.
- `score` — czyste, szybkie (CPU), bez retry.
- `deliver` — digest/alert/outreach; idempotentne po `Delivery`.
- DLQ dla trwałych błędów + alert na `SourceState.healthy=false`.

## 5. Agenci AI

| Agent | Zadanie | Model | Determinizm |
|---|---|---|---|
| **Enrich** | język, budżet, kategorie, streszczenie intencji | gpt-4o-mini | temp=0, JSON mode, fallback heurystyczny |
| **Scoring** | 0–100 intencji (czysta funkcja) | — (kod) | w pełni deterministyczny, testowany |
| **Proposal** | przepisanie draftu w tonie klienta | gpt-4o-mini/4o | scaffold z `@radar/core` + LLM |
| **Self-improve** (faza 2) | re-tuning wag na etykietach WON/LOST | — | offline batch |

Zasada: **decyzje (scoring) deterministyczne i tanie**, LLM tylko do normalizacji
i języka. Dzięki temu koszt i jakość są przewidywalne.

## 6. MCP ✅ (działa)

RadarPL wystawia **serwer MCP** (`radar-mcp`, stdio/JSON-RPC 2.0, zero zależności)
— leady i sterowanie pipeline'em dostępne dla agentów klienta (Claude/Cursor/n8n)
jako narzędzia. 10 narzędzi, m.in.:
- `radar_list_leads(tenantId, min)` — leady wg intencji,
- `radar_get_draft(leadId)` — gotowy draft,
- `radar_approve` / `radar_send` — bramka i wysyłka outreachu,
- `radar_mark(leadId, status)` — sprzężenie zwrotne do self-improve,
- `radar_run_cycle` / `radar_train` — pełny cykl i trening.

Implementacja i rejestracja: `radar/agent/mcp/` (+ `mcp.example.json`). To czyni
produkt „agent-native": klient podpina RadarPL do własnego workflowu AI.

## 7. API (Next.js, App Router)

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/health` | GET | status + sprawdzenie DB (503 gdy degraded) |
| `/api/ingest` | POST | wejście dla crawlerów/n8n; walidacja zod; idempotentne |
| `/api/leads` | GET | leady tenanta wg score/status |
| `/api/leads/:id/draft` | POST | (faza 2) generuj draft |
| `/api/stripe/webhook` | POST | (faza 2) zmiany subskrypcji |

Autoryzacja: API key per tenant (nagłówek) + RLS-like filtrowanie po `tenantId`.

## 8. Integracje

- **OpenAI** — enrich + draft.
- **Stripe** — subskrypcje i webhooki.
- **Resend / SMTP** — digesty i outreach.
- **Slack/Webhook** — alerty real-time.
- **n8n** — harmonogram, fan-out, human-in-the-loop approval.
- **Useme API** — wycena/rozliczenie (re-use istniejącego narzędzia w repo root).

## 9. Monitoring, logowanie, bezpieczeństwo

**Monitoring/observability**
- OpenTelemetry (trace crawl→score→deliver), metryki: leady/dzień, koszt LLM/tenant, latencja kolejek, zdrowie źródeł.
- `/api/health` dla uptime-checków; alerty na DLQ i `SourceState.healthy=false`.

**Logowanie**
- Strukturalne JSON logi (pino) z `tenantId`/`signalId`/`requestId`.
- Audyt `Delivery` (co, do kogo, kiedy) — zgodność i debug.

**Bezpieczeństwo**
- Sekrety w env/secret manager, nigdy w repo (`.env` w `.gitignore`).
- Izolacja tenantów po `tenantId` na każdym zapytaniu; API key hashowany.
- Rate-limit + walidacja wejścia (zod) na `/api/ingest`.
- Crawl etyczny: respekt `robots.txt`/ToS, własny `User-Agent`, backoff, preferencja oficjalnych feedów/API.
- RODO: minimalizacja danych osobowych; sygnały to oferty/zapytania biznesowe, nie profile osób; prawo do usunięcia (cascade po `Tenant`).

## 10. Co już działa (Etap 9)

- `@radar/core` — scoring, dedup, ICP-matching, draft: **12 testów `node --test` ✅**
- `@radar/worker` — parser RSS/Atom + pipeline ingestu: **2 testy ✅**
- Schemat DB, docker-compose (Postgres/Redis/n8n/web/worker), API routes, Dockerfile'e — gotowy scaffold do `pnpm install && docker compose up`.

Następny krok: podłączenie adapterów Prisma w workerze + pierwszy realny crawl
oficjalnego feedu i ręczny outreach do 50 freelancerów (proof-of-value).
