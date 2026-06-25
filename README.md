# Useme Tool 🇵🇱

Narzędzie wiersza poleceń do **zarabiania na [Useme](https://useme.com)** i kontroli „co trzeba zrobić”.
Łączy trzy rzeczy w jednym:

1. **Przewodnik „jak zarobić”** – krok po kroku, z checklistą onboardingu.
2. **Tracker zleceń (pipeline)** – panel kontrolny: co masz w toku, terminy, zarobki.
3. **Klient oficjalnego API Useme** – integracja po stronie zleceniodawcy (rozliczanie freelancerów).

Działa na czystym Pythonie 3.10+ — **zero zależności** (tylko biblioteka standardowa).

---

## Szybki start

```bash
# uruchomienie bez instalacji
python3 -m useme_tool guide

# albo przez wrapper
./useme guide

# (opcjonalnie) instalacja jako komenda `useme`
pip install -e .
useme guide
```

---

## 1. Jak zarobić na Useme — w skrócie

Useme to polska platforma, na której **freelancer (osoba fizyczna, bez działalności)**
wykonuje zlecenia, a serwis wystawia za niego fakturę i rozlicza podatki.

Ścieżka zarabiania:

1. **Rejestracja** jako freelancer na `useme.com`.
2. **Weryfikacja** danych i konta do wypłat.
3. **Profil + portfolio** – im konkretniej, tym lepiej.
4. **Przeglądaj zlecenia** na `useme.com/pl/jobs/`.
5. **Aplikuj** – w zleceniu kliknij **„Dodaj ofertę”** i napisz propozycję.
6. **Realizuj** po akceptacji oferty.
7. **Przekaż pracę** – zleceniodawca ma **7 dni** na akceptację/poprawki.
8. **Wypłata** – po akceptacji środki trafiają na Twoje konto.

**Opłata serwisowa Useme: 7,8% wartości umowy, maksymalnie 349 zł.**

Pełną, odhaczalną checklistę masz w narzędziu:

```bash
useme guide                      # pokaż plan + postęp
useme guide --done rejestracja   # odhacz krok
useme guide --undone rejestracja # cofnij
```

---

## 2. Kalkulator zarobków

```bash
useme calc 1000                  # ile dostaniesz z umowy na 1000 zł
useme calc 1000 --target-net     # ile zafakturować, by „na rękę” było 1000 zł
```

---

## 3. Panel kontrolny — pipeline zleceń

Etapy: `lead → applied → won → in_progress → delivered → accepted → paid`

```bash
useme job add "Landing page" --client "Firma X" --amount 1500 --stage applied --deadline 2026-07-01
useme job list                   # lista wszystkich
useme job list --stage in_progress
useme job set 1 --stage paid     # przesuń etap
useme job rm 1                   # usuń
useme status                     # podsumowanie: pipeline, zarobki, terminy po dacie
```

`useme status` pokazuje też **zlecenia po terminie** i postęp onboardingu.

---

## 4. Integracja z API Useme (zleceniodawca)

> API Useme jest przeznaczone dla **zleceniodawców / firm** rozliczających freelancerów
> (tworzenie kontraktorów, umów, pobieranie kategorii, wgrywanie plików).
> Dokumentacja: <https://apidocs.useme.com/>. Autoryzacja: **token w nagłówku Authorization**.

```bash
# konfiguracja
useme config set-token TWOJ_TOKEN
useme config set-env sandbox     # lub prod (domyślnie)
useme config show

# zapytania
useme api ping                   # sprawdź połączenie i token
useme api categories             # kategorie/podkategorie
useme api contractors            # lista kontraktorów
useme api deals                  # lista umów
useme api deals --id 123         # szczegóły umowy
```

Token można też podać przez zmienne środowiskowe:

```bash
export USEME_TOKEN=...   # token API
export USEME_ENV=sandbox # prod|sandbox
export USEME_HOME=~/.useme   # gdzie trzymane są dane (domyślnie ~/.useme)
```

---

## Struktura projektu

```
useme_tool/
  config.py   # token, środowisko, lokalizacja danych
  api.py      # klient API Useme (urllib, bez zależności)
  guide.py    # treść przewodnika + kalkulator opłaty serwisowej
  tasks.py    # lokalny store zleceń + checklista (JSON)
  cli.py      # interfejs wiersza poleceń
```

Dane (zlecenia, odhaczone kroki, token) zapisywane są lokalnie w `~/.useme/`
i **nie trafiają do repozytorium** (patrz `.gitignore`).

---

## Uwaga

Useme nie udostępnia publicznego API do *przeglądania/aplikowania* na zlecenia po stronie
freelancera — ten etap robi się ręcznie na stronie. Dlatego narzędzie wspiera freelancera
**checklistą + trackerem**, a integrację API kieruje tam, gdzie ona realnie istnieje
(strona zleceniodawcy).
