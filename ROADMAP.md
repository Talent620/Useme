# RadarPL — roadmapa 100 ulepszeń

Priorytetyzacja wg ROI = autonomia × przychód / trud. ✅ = już wdrożone w tej iteracji.

## A. Źródła i market intelligence
1. Oficjalne API Useme (token zleceniodawcy) jako realne źródło.
2. ✅ Kuratorowane źródła RSS (HN/Reddit/RemoteOK/TED).
3. Adapter JSON dla HN Algolia (pełna treść + komentarze).
4. Adapter Reddit JSON z paginacją.
5. Monitoring Google Trends (relatywny popyt kategorii).
6. Monitoring GitHub (issues „looking for maintainer/contractor").
7. Monitoring LinkedIn (publiczne posty intencyjne) — ToS-aware.
8. Monitoring funding rounds (Crunchbase/News RSS).
9. Monitoring nowych firm (CEIDG/KRS) → timing outreach.
10. Globalny dedup cross-tenant + cache fetch.

## B. Inteligencja decyzji (zamknięcie pętli)
11. Wpięcie `rank` w wybór źródeł co cykl (bandit).
12. Wpięcie `rank` w wybór kanału outreachu.
13. Wpięcie `pricing` w generację oferty (rekomendowana cena w draftcie).
14. Wpięcie `memory.winRate` w scoring (priors per kategoria/źródło).
15. Auto-dostrojenie wag `pricing` z historii win/loss.
16. Auto-dostrojenie wag scoringu z `memory`.
17. Multi-armed bandit dla wariantów treści oferty (A/B).
18. Thompson sampling zamiast epsilon-greedy (opcjonalnie).
19. Reranking ICP wg realnego ROI z `memory`.
20. Auto-eksperymenty (eksploracja kontrolowana budżetem).

## C. Negocjacje i CRM
21. Agent negocjacji (auto-dialog follow-up z limitami).
22. ✅ Sekwencje follow-up + kadencja.
23. Lead nurturing wielokanałowy (email→slack→...).
24. Cross-sell/upsell na bazie `clientProfile`.
25. Wykrywanie „intent to churn" u klientów konkurencji.
26. Scoring szansy wygranej per lead (P(win) w pipeline).
27. Auto-przypomnienia o terminach (deadline zleceń).
28. Reaktywacja martwych leadów po N dniach.
29. Personalizacja first-touch z `industryProfile`.
30. Kolejka rozmów z priorytetem wg wartości oczekiwanej.

## D. Egzekucja premium
31. Generator pełnej aplikacji (scaffold Next/React) + sandbox.
32. Generator SaaS boilerplate (auth/billing/CRUD).
33. Generator wielostronicowych landing page (sekcje + SEO).
34. Generator workflow n8n z realnymi węzłami integracji.
35. Generator automatyzacji (skrypty + cron).
36. Generator dokumentacji technicznej z kodu.
37. Audyty wydajności (Core Web Vitals z realnej strony).
38. Pełne analizy SEO (linki, schema, konkurencja).
39. Generator treści długich (z researchem i cytowaniami).
40. Sandboxing wykonawców kodu (izolacja, limity).

## E. Agent jakości
41. ✅ best-of-N + iteracja + repair (100/100).
42. Wieloetapowa krytyka (ensemble lensów: poprawność/SEO/UX).
43. Consensus scoring (głosowanie krytyków).
44. Confidence estimation kalibrowane historią akceptacji.
45. Quality gates per kanał dostawy.
46. Adwersarialna weryfikacja (próba obalenia deliverable).
47. Auto-poprawki z feedbacku klienta (REVISION → re-exec).
48. Wykrywanie plagiatu/duplikacji treści.
49. Walidacja HTML/JSON/kodu przez realne parsery.
50. Benchmark jakości per kompetencja (regresja jakości).

## F. Finanse i ekonomia
51. ✅ P&L, MRR, CAC, LTV, ROI.
52. Cashflow w czasie (wpływy/wypływy).
53. Prognozy przychodu z sezonowością.
54. Prognozy marży per kategoria.
55. Budżetowanie kosztów LLM per tenant.
56. Alerty ekonomiczne (marża < próg, CAC > LTV).
57. Modelowanie cen elastycznych (popyt vs cena).
58. Rozliczanie usage-based (poza planami).
59. Faktury/raporty miesięczne (PDF).
60. Symulacje scenariuszy „co jeśli".

## G. Forecasting i strategia
61. ✅ Holt + momentum + prealokacja.
62. Wykrywanie sezonowości (dekompozycja).
63. Wykrywanie anomalii (spike/dropout).
64. Prognozy per źródło (nie tylko kategoria).
65. ✅ Auto-wyłączanie martwych źródeł.
66. Auto-skalowanie skutecznych źródeł (więcej crawla).
67. Auto-podnoszenie cen w kategoriach o wysokim popycie.
68. Auto-podnoszenie progu jakości w słabych kompetencjach.
69. Predykcja „demand heatmap" (miasto/branża/tydzień).
70. Sygnały wyprzedzające (leading indicators).

## H. Platforma, API, skalowanie
71. OpenAPI 3.1 + generowane SDK.
72. Pełne REST (CRUD tenant/ICP/lead/deal).
73. Event bus + webhooki (lead.created, deal.won...).
74. Worker queue (Redis/BullMQ) dla crawl/enrich/exec.
75. Horizontal scaling (stateless workery + Postgres).
76. Cache (Redis) + rate-limit globalny.
77. Multi-tenant izolacja danych (RLS w Postgres).
78. Idempotency keys na API.
79. Migracje wersjonowane + seed.
80. Health/readiness + graceful drain.

## I. Obserwowalność i bezpieczeństwo
81. OpenTelemetry tracing (crawl→exec→deliver).
82. Metryki (Prometheus): leady/h, koszt LLM, latencje.
83. Audit log podpisany (kto/co/kiedy).
84. Replay system (odtwarzanie cyklu z logów).
85. RBAC (role: owner/operator/viewer).
86. Secrets management (Vault/age) + rotacja.
87. Signed actions (HMAC na akcjach krytycznych).
88. Rate-limit per API key.
89. PII minimization + RODO erasure.
90. Bug bounty/security.md + scan zależności.

## J. Ekosystem, mobile, dystrybucja
91. Integracje: Stripe (✅ scaffold), Slack, Discord, Telegram.
92. Integracje: Resend (✅), GitHub/GitLab, Notion, Airtable.
93. Integracje: HubSpot, Pipedrive (sync pipeline).
94. n8n nodes (✅ scaffold) + publikacja w marketplace.
95. Push notyfikacje w aplikacji mobilnej.
96. Mobile: approve/reject/monitoring/raporty offline.
97. Podpisany release APK (zamiast debug) + Play Store.
98. Dashboard: wykresy/heatmapy/trendy/stan agentów (SVG).
99. Dashboard: historia decyzji + replay wizualny.
100. Self-hosting one-click (docker compose + helm).
