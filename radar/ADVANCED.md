# RadarPL — moduły zaawansowanej autonomii

Warstwa, która zamienia silnik w **autonomiczną firmę**: pamięć, ekonomia,
ranking decyzji, ceny, CRM, market-intel i zespół agentów. Wszystko
deterministyczne, lokalne, testowane; LLM = opcjonalny wzmacniacz.

## `memory.ts` — pamięć długoterminowa (moat danych)
Trwała baza wyników (`data/memory.json`): transakcje win/loss, profile klientów,
branż i ICP, historia negocjacji. Zasilana przy `mark WON/REJECTED`.
- `recordDeal`, `recordNegotiation`, `winRate(filter)`, `avgWinPrice(category)`,
  `industryProfile`, `clientProfile`, `arms()`, `stats()`.
- Karmi pricing, ranking i agentów realnymi danymi — przewaga rośnie z czasem.

## `rank.ts` — ranking RL-lite (bandit EWMA)
Uczy się, które „ramiona" (źródła, kanały outreachu, ICP, progi cenowe) dają
najlepszy zwrot. Deterministyczny: eksploracja przez seedowany hash, nie `random`.
- `update(table, arm, reward, α)`, `rank(table)`, `pick(table, arms, ε, seed)`,
  `rewardOf(outcome, value)`.

## `pricing.ts` — dynamiczne ceny
Logistyczny model prawdopodobieństwa wygranej + grid-search maksymalizujący
wartość oczekiwaną (cena × P(win) − koszt).
- `winProbability(fraction, features, weights)`, `recommendBid(budget, cost, features)`,
  `competitionScore(similarCount)`. Wagi domyślne, dostrajalne z historii (memory).

## `finance.ts` — agent finansowy (CFO)
Pełna ekonomia: P&L, MRR, marża, ROI, **CAC, LTV, LTV/CAC**, prognoza przychodu.
- `financials(facts, tenants, opts)`, `revenueForecast(mrr, months, growth)`.

## `crm.ts` — autonomiczny CRM
Pipeline + sekwencje follow-up (kadencja, limit prób, gotowe szablony PL).
- `stageOf`, `pipeline(leads)`, `dueFollowUps(leads, now, cadence, maxAttempts)`,
  `sequenceMessage(attempt, title)`.

## `intel.ts` — market intelligence
Klasyfikacja intencji zakupowej + kuratorowany rejestr publicznych źródeł RSS
(HN, Reddit for-hire, RemoteOK, TED). Wszystko RSS → przez istniejący grzeczny
fetcher; bez ryzykownego scrapingu.
- `classifyIntent(text)` → hiring/rfp/seeking/complaint/launch/none,
  `isDemandSignal`, `mine(items)`, `DEMAND_SOURCES`.

## `agents.ts` — zespół agentów (boardroom)
Ośmiu wyspecjalizowanych agentów (CEO, Sales, Research, Outreach, Execution, QA,
Finance, Strategy) czyta wspólny stan (Store + Memory) i zwraca widoki +
rekomendacje; **CEO syntetyzuje priorytety**. Deterministyczna koordynacja nad
istniejącymi silnikami.
- `boardroom(store, cfg, now, memory?)`.

## Sterowanie
- CLI: `board`, `finance`, `crm` (+ `mark` karmi pamięć).
- MCP: `radar_board`, `radar_finance`, `radar_crm` (łącznie 21 narzędzi).
- Akcje współdzielone: `runBoard`, `runFinance`, `runCrm`, `recordToMemory`.

## Zasady projektowe (utrzymane)
Pełna kompatybilność wsteczna · zero atrap/TODO · każda funkcja z testami
(`agent/test/intelligence.test.ts`, `agent/test/agents.test.ts`) · działa bez
`OPENAI_API_KEY` · produkcyjne.
