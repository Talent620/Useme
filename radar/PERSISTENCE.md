# RadarPL — persystencja: dwa tryby

Ten sam rdzeń scoringu/matchingu, dwa backendy — wybierasz wg skali.

## 1. Tryb agenta (single-node, zero infra) — domyślny
- Plik JSON: `radar/data/store.json` (klasa `Store`).
- Idealny do autonomicznego agenta i GitHub Actions (cache jako persystencja).
- Zero zależności, działa od ręki.

## 2. Tryb produkcyjny SaaS (Postgres/Prisma) — multi-tenant, multi-node
- Włączasz przez `DATABASE_URL`. Fabryka `createLeadRepo()` wybiera backend:
  - `DATABASE_URL` ustawione → `PrismaLeadRepo` (Postgres),
  - brak → `InMemoryLeadRepo` (dev/test, seedowany z `config/tenants.json`).
- Web API (`/api/ingest`, `/api/leads`) używa tej samej fabryki i **tego samego
  pipeline'u** (`agent/ingest-pipeline.ts`) co agent — file-mode i Postgres-mode
  zachowują się identycznie.

### Setup Postgres
```bash
cd radar
cp .env.example .env            # ustaw DATABASE_URL
docker compose up -d postgres   # lub własny Postgres
pnpm db:generate                # prisma generate
pnpm db:migrate                 # zastosuj migracje (prisma/migrations/0001_init)
```

### Architektura warstwy danych
```
            ┌────────────────────────────┐
ingest()  → │  LeadRepo (interfejs async) │ →  listLeads()
            └─────────────┬──────────────┘
                          │
        ┌─────────────────┴──────────────────┐
   InMemoryLeadRepo                     PrismaLeadRepo
   (dev/test, tested)                   (Postgres, produkcja)
```

- `agent/repo.ts` — interfejs `LeadRepo` (hasSignal, createSignal, listActiveICPs,
  upsertLead, listLeads). Async = Postgres to drop-in.
- `agent/repo-memory.ts` — implementacja referencyjna (testowana: `agent/test/repo.test.ts`).
- `agent/repo-prisma.ts` — implementacja Postgres (lazy `@prisma/client`).
- `prisma/schema.prisma` + `prisma/migrations/0001_init/migration.sql` — schemat i migracja.

### Idempotencja i bezpieczeństwo danych
- Ingest idempotentny po `Signal.dedupeKey` (unique), leady po
  `(tenantId, signalId, icpId)` (unique) — bez duplikatów między batchami.
- Izolacja tenantów po `tenantId` na każdym zapytaniu; kasowanie kaskadowe po `Tenant`.
