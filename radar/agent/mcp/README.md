# radar-mcp — serwer MCP RadarPL

Udostępnia RadarPL jako **narzędzia dla Twojego agenta** (Claude Desktop/Code,
Cursor, n8n). Dzięki temu agent sam pobiera leady, akceptuje i wysyła oferty oraz
trenuje scoring — RadarPL staje się kanałem dystrybucji, nie tylko produktem.

Transport: **stdio, JSON-RPC 2.0** (newline-delimited). Zero zależności — Node 22
uruchamia `.ts` natywnie.

## Uruchomienie
```bash
cd radar
node agent/mcp/server.ts        # lub: pnpm mcp
```

## Rejestracja w hoście MCP

**Claude Desktop / Cursor** (`mcpServers` w configu):
```json
{
  "mcpServers": {
    "radar": {
      "command": "node",
      "args": ["/ABSOLUTNA/SCIEZKA/radar/agent/mcp/server.ts"],
      "env": {
        "RADAR_DATA_DIR": "/ABSOLUTNA/SCIEZKA/radar/data",
        "OPENAI_API_KEY": "sk-...",
        "RADAR_CONFIG": "/ABSOLUTNA/SCIEZKA/radar/config/tenants.json"
      }
    }
  }
}
```
Przykład gotowy do skopiowania: [`mcp.example.json`](./mcp.example.json).

## Narzędzia (24)

| Narzędzie | Działanie |
|---|---|
| `radar_status` | statystyki: sygnały, leady, wysyłki, modele, zdrowie źródeł |
| `radar_list_leads` | leady wg intencji (filtr: `tenantId`, `min`) |
| `radar_get_draft` | pełny draft wiadomości dla leada |
| `radar_outbox` | leady czekające na akceptację/wysyłkę |
| `radar_approve` | zatwierdź lead (`leadId` lub `all`) |
| `radar_reject` | pomiń lead |
| `radar_send` | wyślij zaakceptowane (dzienny limit) |
| `radar_mark` | ustaw wynik (WON/REPLIED/REJECTED) → zasila uczenie |
| `radar_train` | przelicz modele scoringu |
| `radar_run_cycle` | pełny cykl crawl→score→draft→dostawa |
| `radar_onboard` | z opisu freelancera: auto-ICP + proof-of-value (+`register`) |
| `radar_execute` | autonomicznie zrealizuj wygrane zlecenia (deliverable + pewność) |
| `radar_work` | wykonaj konkretne zlecenie na żądanie (deliverable + pliki) |
| `radar_mark_exec` | werdykt klienta o deliverable (ACCEPTED/REVISION/REJECTED) |
| `radar_quality` | model jakości wykonania — samokalibracja bramki per kompetencja |
| `radar_strategy` | agent-CEO: P&L lejka + rekomendacje realokacji (`apply` auto-wyłącza martwe źródła) |
| `radar_forecast` | prognoza popytu per kategoria (trend/momentum/predykcja) + prealokacja |
| `radar_rank` | RL-lite: czego agent nauczył się z wyników (wartość per źródło/kanał/kategoria) |
| `radar_price` | dynamiczna wycena leada: cena + P(wygranej) + wartość oczekiwana |
| `radar_price_train` | kalibracja wag modelu cenowego z historii win/loss (elastyczność cenowa) |
| `radar_report` | panel operatora: pełny stan + lista 'co trzeba zrobić' |
| `radar_board` | zespół agentów (CEO/Sales/.../Finance) + priorytety CEO |
| `radar_finance` | agent finansowy: P&L, MRR, CAC, LTV, ROI |
| `radar_crm` | CRM: pipeline + follow-upy |

## Przykładowy przepływ w rozmowie z agentem
> „Uruchom cykl, pokaż leady demo-wp powyżej 80, zaakceptuj najlepszy i wyślij."

Agent woła: `radar_run_cycle` → `radar_list_leads{tenantId:"demo-wp",min:80}` →
`radar_approve{leadId}` → `radar_send`. Wszystko logowane w store (audyt).

## Bezpieczeństwo
- Logi serwera idą na **stderr**, kanał stdout to wyłącznie JSON-RPC.
- Te same bramki co w CLI: `radar_send` wysyła tylko zaakceptowane, z dziennym
  limitem; wysyłka idempotentna. Domyślny kanał `file` nie wysyła nic na zewnątrz.
