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

## `pricing.ts` — dynamiczne ceny (samokalibrujące się)
Logistyczny model prawdopodobieństwa wygranej + grid-search maksymalizujący
wartość oczekiwaną (cena × P(win) − koszt).
- `winProbability(fraction, features, weights)`, `recommendBid(budget, cost, features, weights)`,
  `competitionScore(similarCount)`.
- **`calibrateWeights(samples, base, opts)`** — uczy wag (bias, intent, wrażliwość
  na cenę) z realnej historii win/loss przez deterministyczną regresję logistyczną
  (stała liczba iteracji, stały lr, init = priory, L2 do priorów). Bez losowości,
  bez LLM: te same dane → te same wagi. Poniżej `minSamples` zwraca priory
  (cienka historia nie destabilizuje). System **sam poznaje swoją elastyczność
  cenową** — przy jakim ułamku budżetu zaczyna przegrywać oferty.
- `Memory.priceSamples()` dostarcza `{priceFraction, score, win}` z zamkniętych
  transakcji (fraction = bid / budżet). 3. pętla uczenia (po scoringu i jakości).

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
4. **Cena uczy się elastyczności** — `runPriceTrain` (auto co cykl, krok 5b)
   kalibruje wagi modelu cenowego z `Memory.priceSamples()`; cykl i `runPrice`
   używają wyuczonych wag (`store.getPriceWeights()`), z fallbackiem do priorów.
- Akcje: `runRank(store)`, `runPrice(store, leadId)`, `runPriceTrain(store)`. Testy:
  `agent/test/closure.test.ts` (cena na każdym leadzie, wzrost wartości ramienia
  po WON, brak wzrostu po REJECTED, trzy osie rankingu) oraz
  `agent/test/pricing-calibrate.test.ts` (nauka elastyczności, determinizm,
  persystencja wag, próbki z pamięci).

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
- CLI: `board`, `finance`, `crm`, `rank`, `price <leadId>`, `price-train`
  (+ `mark` karmi pamięć i bandita).
- MCP: `radar_board`, `radar_finance`, `radar_crm`, `radar_rank`, `radar_price`,
  `radar_price_train` (łącznie 24 narzędzia).
- Akcje współdzielone: `runBoard`, `runFinance`, `runCrm`, `runRank`, `runPrice`,
  `runPriceTrain`, `recordToMemory`.

## Zasady projektowe (utrzymane)
Pełna kompatybilność wsteczna · zero atrap/TODO · każda funkcja z testami
(`agent/test/intelligence.test.ts`, `agent/test/agents.test.ts`,
`agent/test/closure.test.ts`) · działa bez `OPENAI_API_KEY` · produkcyjne.
