# RadarPL — tryb autonomiczny 🤖

Agent kręci pełny cykl **bez Ciebie**: crawl → normalizacja → dedupe → enrich (AI)
→ scoring → draft wiadomości → dostawa digestu. Stan trwa między uruchomieniami,
cykle są idempotentne (ten sam sygnał nigdy nie tworzy dwóch leadów ani dwóch wysyłek).

```
źródła publiczne ─► fetch (file:/http) ─► enrich ─► score(ICP) ─► Store(JSON/Postgres)
                                                          │
                                          draft + digest ◄┘ ─► plik / webhook / Slack
```

## Co robi sam, a co wymaga Ciebie

| Krok | Kto |
|---|---|
| Pobranie sygnałów ze źródeł | 🤖 agent |
| Wzbogacenie (język, budżet, kategorie) | 🤖 agent (AI) |
| Ocena intencji 0–100 wg Twojego ICP | 🤖 agent |
| Wygenerowanie draftu pierwszej wiadomości | 🤖 agent |
| Dostawa digestu (plik/webhook/Slack/e-mail) | 🤖 agent |
| Zakolejkowanie wysokopunktowych leadów do outreachu | 🤖 agent |
| **Akceptacja wysyłki (bramka)** | 🧑 Ty (lub `autoApprove:true`) |
| Wysłanie zaakceptowanej oferty + limit dzienny | 🤖 agent |
| Dodanie/zmiana źródeł i ICP | 🧑 Ty (raz, w `config/tenants.json`) |

Człowiek konfiguruje raz i akceptuje wysyłki. Reszta jest automatyczna.

## Pętla outreachu (lead → realna oferta → przychód)

Leady z wynikiem ≥ `outreach.threshold` (domyślnie 75) trafiają do kolejki. Ty
decydujesz, co wychodzi — albo włączasz pełne auto.

```bash
node agent/cli.ts outbox            # co czeka na wysłanie (z wynikiem)
node agent/cli.ts approve <leadId>  # zatwierdź jeden
node agent/cli.ts approve all       # zatwierdź wszystkie czekające
node agent/cli.ts reject <leadId>   # pomiń
node agent/cli.ts send              # wyślij zaakceptowane (respektuje dzienny limit)
node agent/cli.ts mark <leadId> WON # wynik sprzedażowy (zasili scoring w fazie 2)
```

**Kanały wysyłki** (`tenant.channel`):
- `file` (domyślnie, **bezpieczne**) — gotowa wiadomość ląduje w `data/outbox/<tenant>_<lead>.txt`; wklejasz ją na platformie/w mailu. Zero ryzyka spamu.
- `webhook` → `RADAR_WEBHOOK_URL` (np. do Twojej automatyzacji).
- `slack` → `SLACK_WEBHOOK_URL`.
- `email` → `RESEND_API_KEY` (+ `RESEND_FROM`).

**Pełna autonomia wysyłki:** ustaw `settings.outreach.autoApprove: true` i kanał
inny niż `file` — wtedy cron sam zatwierdza i wysyła (z limitem `dailyCapPerTenant`).
Każda wiadomość ma stopkę zgodności i opcję STOP. Wysyłka jest **idempotentna** —
ten sam lead nigdy nie wyjdzie dwa razy.

## Self-improving scoring (system uczy się sam)

Twoje decyzje `mark <leadId> WON|REPLIED|REJECTED` to dane treningowe. Agent uczy
per-tenant modelu wag słów kluczowych (log-odds, deterministycznie — bez ML) i
**sprzęga go zwrotnie ze scoringiem**: leady podobne do tych, które historycznie
wygrałeś, dostają wyżej; podobne do odrzuconych — niżej.

```bash
node agent/cli.ts mark lead_3 WON       # zamknięte zlecenie
node agent/cli.ts mark lead_7 REJECTED  # nietrafione
node agent/cli.ts train                 # przelicz modele (lub autoTrain co cykl)
```

- `settings.learn.autoTrain: true` — model przeliczany na końcu każdego cyklu.
- `settings.learn.minExamples` — ile etykiet zanim model zacznie działać (domyślnie 5).
- Boost jest ograniczony do ±15 pkt, więc uczenie **dostraja ranking**, nie nadpisuje
  deterministycznej bazy. Model jest wytłumaczalny (widać wagi w `status`).

Przykład efektu: nowy sygnał WordPress dla tenanta, który wygrywał zlecenia WP —
score **74 → 89** po nauczeniu. To jest moat danych: im dłużej działa, tym celniej trafia.

## 3 sposoby uruchomienia

### 1) Chmura, za darmo — GitHub Actions (zalecane)
Plik `.github/workflows/radar-autonomous.yml` odpala cykl **co 2h** na serwerach GitHuba.
- Stan trzymany w cache między uruchomieniami, digesty jako artefakty.
- Sekrety (opcjonalne): `OPENAI_API_KEY`, `RADAR_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`.
- **Uwaga:** harmonogram `cron` firuje tylko gdy workflow jest na **gałęzi domyślnej** repo. Po zmerge'owaniu zacznie chodzić sam. Ręcznie: zakładka *Actions → Run workflow*.

### 2) Lokalnie / VPS — pętla
```bash
cd radar
node agent/cli.ts loop      # chodzi w nieskończoność, interwał z config/tenants.json
```
Na serwerze owiń w `systemd`/`pm2`, by wstawało po restarcie.

### 3) n8n / dowolny cron
```bash
*/30 * * * *  cd /opt/radar && node agent/cli.ts once
```

## Sterowanie (minimum interwencji)
```bash
node agent/cli.ts once               # jeden cykl teraz
node agent/cli.ts status             # statystyki + zdrowie źródeł
node agent/cli.ts leads [tenantId]   # lista leadów wg intencji
node agent/cli.ts draft <leadId>     # gotowy draft do skopiowania
node agent/cli.ts mark <leadId> WON  # sprzężenie zwrotne (uczy scoring w fazie 2)
```

## Realne źródła (grzeczny crawl)
Włączasz feed w `config/tenants.json` (`enabled: true`). Live fetch jest dobrym obywatelem:
- **robots.txt** — przed pobraniem sprawdzamy, czy nasz UA ma wstęp (wyłącznik awaryjny `CRAWL_IGNORE_ROBOTS=1`, używaj świadomie).
- **rate-limit per host** — min. odstęp `CRAWL_MIN_DELAY_MS` (domyślnie 1500 ms).
- **warunkowy GET** — ETag/Last-Modified zapisywane w SourceState; niezmieniony feed zwraca 304 i nic nie kosztuje.
- **własny User-Agent** `CRAWL_USER_AGENT`, timeouty, preferencja oficjalnych feedów/API.
> Przed włączeniem źródła sprawdź jego ToS. Domyślnie aktywny jest tylko `sample` (fixture).

## Konfiguracja (jedyne, co robisz ręcznie)
`config/tenants.json`:
- **sources** — co crawlować (`file:` = fixture/test, `http(s)://` = realny feed; włącz `enabled: true`).
- **tenants** — dla kogo (Ty/klienci): profil nadawcy + ICP (słowa kluczowe, wykluczenia, kategorie, budżet, języki).
- **settings** — `intervalMinutes`, `threshold` (min. score na leada), `maxLeadsPerDigest`.

## Persystencja
- Tryb agenta: `radar/data/store.json` (zero zależności — działa od ręki).
- Produkcja: ten sam interfejs na Postgres/Prisma (`apps/web`, `prisma/schema.prisma`).
- Dedupe po `dedupeKey` (FNV-1a z tytułu + koszyk budżetu) — sygnał widziany raz nie wraca.

## Bezpieczeństwo / etyka
Tylko dane publiczne, własny `User-Agent`, timeouty, respekt ToS/robots.txt, preferencja
oficjalnych feedów. Dostawa „best-effort" do webhooków, ale **plik digestu zawsze powstaje**
(trwały ślad audytowy).
