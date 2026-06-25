# RadarPL — audyt i mapa braków (ETAP 1)

Skala 1–5. **Autonomia** = wpływ na samodzielność systemu. **Przychód** = wpływ na
pieniądze. **Trud** = trudność wdrożenia. **ROI** = autonomia×przychód / trud.

## Stan po tej iteracji (zaadresowane)
| Obszar | Status |
|---|---|
| Pamięć długoterminowa (moat) | ✅ `memory.ts` |
| Multi-agent (8 agentów + CEO) | ✅ `agents.ts` |
| Agent finansowy (CAC/LTV/ROI) | ✅ `finance.ts` |
| Dynamiczne ceny + P(win) | ✅ `pricing.ts` |
| Ranking RL-lite (źródła/kanały/ICP/ceny) | ✅ `rank.ts` |
| Autonomiczny CRM (follow-upy) | ✅ `crm.ts` |
| Market intel (HN/Reddit/TED + intencja) | ✅ `intel.ts` |
| Self-improving scoring | ✅ `core/learn.ts` |
| Samokalibracja jakości | ✅ `exec/quality.ts` |
| Perfekcyjna egzekucja (best-of-N+repair) | ✅ `exec/` |
| Prognoza popytu | ✅ `forecast.ts` |
| Strategia/P&L (agent-CEO) | ✅ `strategy.ts` |
| Onboarding + proof-of-value | ✅ `onboarding.ts` |
| Billing (plany rządzą runtime) | ✅ `billing.ts` |
| Persystencja file/Postgres | ✅ `repo*.ts` |
| Panel web + mobile + 3 binarki + auto-update | ✅ |

## Bottlenecki / ryzyka / braki (do roadmapy)
| # | Element | Typ | Autonomia | Przychód | Trud | ROI |
|---|---|---|:-:|:-:|:-:|:-:|
| 1 | Realne źródło popytu (Useme API/feed) | bottleneck | 5 | 5 | 3 | ★★★★★ |
| 2 | Event bus + webhooki (Slack/Discord/Telegram) | brak | 4 | 3 | 2 | ★★★★ |
| 3 | Powiązanie rank/pricing/memory → automatyczne decyzje cyklu | brak | 5 | 4 | 2 | ★★★★★ |
| 4 | Telemetria/tracing/audit-log + replay | brak | 3 | 2 | 2 | ★★★ |
| 5 | RBAC + API keys per rola + signed actions | ryzyko | 3 | 2 | 3 | ★★ |
| 6 | OpenAPI + pełne REST (poza `serve`) | brak | 3 | 3 | 2 | ★★★ |
| 7 | Worker queue (BullMQ/Redis) + horizontal scaling | skalowanie | 4 | 3 | 4 | ★★★ |
| 8 | Sandboxing wykonawców kodu (generowanie aplikacji) | ryzyko | 4 | 4 | 5 | ★★★ |
| 9 | Wykrywanie anomalii + sezonowość w forecast | brak | 3 | 3 | 3 | ★★★ |
| 10 | Push notyfikacje w aplikacji mobilnej | brak | 2 | 2 | 3 | ★★ |
| 11 | Integracje CRM (HubSpot/Pipedrive/Notion/Airtable) | brak | 2 | 3 | 3 | ★★ |
| 12 | Negocjacje agentowe (auto follow-up dialog) | brak | 4 | 4 | 4 | ★★★ |
| 13 | Podpisany/wydany APK (zamiast debug) | dystrybucja | 1 | 1 | 2 | ★ |
| 14 | Wektorowa pamheść semantyczna (embeddings, opcjonalna) | brak | 3 | 2 | 4 | ★★ |
| 15 | Cache warstwy fetch + dedup globalny cross-tenant | skalowanie | 2 | 1 | 2 | ★★ |

## Wnioski
- **Najwyższy ROI nie-zaadresowany:** #1 realne źródło popytu (wymaga decyzji
  użytkownika/ToS) i #3 zamknięcie pętli rank/pricing/memory w automatyce cyklu.
- Architektura jest spójna i rozszerzalna (czyste moduły + akcje + CLI/MCP/serve).
- Pełna lista kolejnych kroków: [`ROADMAP.md`](./ROADMAP.md).
