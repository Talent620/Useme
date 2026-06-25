# RadarPL — autonomiczna realizacja zleceń (silnik egzekucji)

Pionierska część: RadarPL nie tylko **znajduje** i **pozyskuje** zlecenia — potrafi je
**wykonać**. Wygrany lead (status `WON`) staje się zleceniem, które wielo-agentowy
silnik realizuje od planu do gotowego produktu, z samo-weryfikacją i bramką pewności.

## Pętla wielo-agentowa

```
Job (z wygranego leada)
  │
  ▼  Planner — routing kompetencji + kryteria akceptacji
TaskSpec[]
  │
  ▼  Capability executor — produkuje artefakt (deterministyczny baseline + LLM)
Artifact ──► Critic — ocena 0..100 względem kryteriów (deterministyczna)
  │             │ passed?  nie → rewizja (depth++, podpowiedzi krytyka) ──┐
  │             └ tak ─────────────────────────────────────────────────┘
  ▼
Packager → deliverable + confidence + bramka (auto / review)
```

- **Planner** (`exec/planner.ts`) — z kategorii wybiera kompetencję(-e) i definiuje
  kryteria akceptacji (min. długość, wymagane sekcje, pokrycie słów kluczowych,
  brak placeholderów, poprawność HTML/JSON).
- **Orkiestrator** (`exec/orchestrator.ts`) — **dynamiczna kompozycja narzędzi**:
  zamiast sztywnych ścieżek w wykonawcach, inspekcjonuje zlecenie + kompetencję i
  uruchamia tylko pasujące narzędzia (research / SEO / generacja obrazu), składając
  `ToolBundle`, który wykonawca konsumuje. Tak ekspert dobiera narzędzia do zadania.
- **Wykonawcy** (`exec/capabilities.ts`) — `writer`, `landing` (HTML), `audit`,
  `spec`, `translate`. Deterministyczny baseline działa offline; z `OPENAI_API_KEY`
  warstwa LLM podnosi jakość do pełnej prozy/kodu.
- **Narzędzia** (`exec/tools/`) — wykonawcy używają realnych narzędzi, nie tylko
  szablonów:
  - `tools/web.ts` — pobiera stronę (http + `file:`), wykrywa URL-e w briefie.
  - `tools/seo.ts` — **realna analiza on-page** (title, meta, H1, ALT, treść,
    viewport, canonical, schema, HTTPS) → audyt z priorytetami na bazie faktycznej strony.
  - `tools/research.ts` — **research z cytowaniami**: pobiera 2–4 źródła, ekstrahuje
    czytelną treść, syntetyzuje artykuł z odnośnikami [n] + sekcją „Źródła".
  - `tools/scaffold.ts` — **buduje działający artefakt**: importowalny workflow
    n8n (poprawny JSON, węzły dobrane do kroków briefu).
  - Deliverables zapisywane też w natywnym formacie (otwieralny `.html`, `.json`).
- **Graf wielozadaniowy** — planner emituje kilka deliverabli, gdy zlecenie tego
  wymaga: `automation → spec + workflow n8n`, `ecommerce → landing + treści`. Każde
  zadanie ma własne kryteria; `confidence` = min ocen (łańcuch tak mocny jak najsłabsze ogniwo).
- **Landing klasy produkcyjnej** — JSON-LD (schema.org), Open Graph, responsywny
  CSS, SVG hero + manifest assetów (prompty do generatora obrazów, np. Higgsfield).
- **Krytyk** (`exec/critic.ts`) — deterministyczna, audytowalna ocena; jego uwagi
  napędzają rewizję (samopoprawę).
- **Silnik** (`exec/engine.ts`) — pętla plan→produkcja→weryfikacja→rewizja do
  spełnienia kryteriów lub wyczerpania budżetu iteracji; pakuje deliverable.

## Bramka autonomii
- `confidence` = min. ocena zadań (łańcuch tak mocny jak najsłabsze ogniwo).
- `confidence ≥ minConfidence` i wszystkie zadania zaliczone → **auto** (gotowe do wydania).
- inaczej → **review** (do przeglądu człowieka). Tłumaczenia bez LLM eskalują automatycznie.

## Użycie
```bash
node agent/cli.ts mark <leadId> WON     # klient zaakceptował
node agent/cli.ts execute               # zrealizuj wygrane (deliverable na dysk)
# albo w pełni automatycznie: settings.execution.autoExecuteOnWon = true (domyślnie)
```
Deliverable ląduje w `data/deliverables/<tenant>_<lead>.md`. Przez MCP: `radar_execute`.

## Konfiguracja (`config/tenants.json` → settings.execution)
```json
{ "enabled": true, "autoExecuteOnWon": true, "maxIterations": 3, "minConfidence": 80 }
```

## Dlaczego to przewaga
- **Pełen łańcuch w jednym systemie**: znajdź → pozyskaj → **wykonaj** → naucz się.
  Koszt krańcowy realizacji bliski zeru, jeden operator obsługuje skalę.
- **Samo-weryfikacja z kryteriami** zamiast „ślepego" outputu LLM — jakość jest
  mierzona i bramkowana, a niska pewność trafia do człowieka.
- **Determinizm + LLM jako wzmacniacz** — działa nawet bez API, a z modelem osiąga
  poziom produkcyjny. Audytowalność oceny buduje zaufanie.
