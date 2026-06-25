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

## Zamknięta pętla decyzji (cykl → wynik → nauka)
Pełne sprzężenie zwrotne, w pełni autonomiczne:
1. **Cykl wycenia każdy lead** — `runCycle` liczy `recommendBid` z intencji leada,
   historycznego win-rate (memory dla kategorii+źródła) i presji konkurencji
   (ile świeżych sygnałów w tej kategorii). Zapisuje `recommendedPrice` +
   `winProbability` na leadzie.
2. **Realny wynik uczy bandita** — `recordToMemory` (wywoływane przy `mark WON/
   REJECTED` w CLI **i** MCP) aktualizuje tabele rank dla trzech osi: `source`,
   `channel`, `category` (`store.updateRank` → EWMA z `rewardOf`). Wygrana o
   większym budżecie daje większą nagrodę (`normalizedBudget`).
3. **Następne cykle korzystają z nauki** — `runRank` / `radar_rank` / sekcja w
   panelu pokazują, w co agent powinien się przechylać; `runPrice` / `radar_price`
   re-wycenia lead na żądanie z aktualnym stanem pipeline'u.
- Akcje: `runRank(store)`, `runPrice(store, leadId)`. Testy:
  `agent/test/closure.test.ts` (cena na każdym leadzie, wzrost wartości ramienia
  po WON, brak wzrostu po REJECTED, trzy osie rankingu).

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
- CLI: `board`, `finance`, `crm`, `rank`, `price <leadId>` (+ `mark` karmi pamięć i bandita).
- MCP: `radar_board`, `radar_finance`, `radar_crm`, `radar_rank`, `radar_price`
  (łącznie 23 narzędzia).
- Akcje współdzielone: `runBoard`, `runFinance`, `runCrm`, `runRank`, `runPrice`,
  `recordToMemory`.

## Zasady projektowe (utrzymane)
Pełna kompatybilność wsteczna · zero atrap/TODO · każda funkcja z testami
(`agent/test/intelligence.test.ts`, `agent/test/agents.test.ts`,
`agent/test/closure.test.ts`) · działa bez `OPENAI_API_KEY` · produkcyjne.
