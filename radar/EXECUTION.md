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

- **Planner** (`exec/planner.ts`) — z kategorii wybiera kompetencję i definiuje
  kryteria akceptacji (min. długość, wymagane sekcje, pokrycie słów kluczowych,
  brak placeholderów, poprawność HTML).
- **Wykonawcy** (`exec/capabilities.ts`) — `writer`, `landing` (HTML), `audit`,
  `spec`, `translate`. Deterministyczny baseline działa offline; z `OPENAI_API_KEY`
  warstwa LLM podnosi jakość do pełnej prozy/kodu.
- **Narzędzia** (`exec/tools/`) — wykonawcy używają realnych narzędzi, nie tylko
  szablonów. `tools/web.ts` pobiera stronę (http + `file:`), `tools/seo.ts`
  **analizuje realne sygnały on-page** (title, meta, H1, ALT, treść, viewport,
  canonical, schema, HTTPS) i generuje audyt z priorytetami na podstawie faktycznej
  strony. Gdy brief zawiera URL → audyt realny; inaczej fallback. Deliverables
  zapisywane też w natywnym formacie (otwieralny `.html`).
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
