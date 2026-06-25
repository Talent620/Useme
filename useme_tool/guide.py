"""Wbudowany przewodnik 'jak zarobić na Useme' + kalkulator opłaty serwisowej.

Źródła: help.useme.com oraz oficjalne materiały Useme.
Opłata serwisowa: 7,8% wartości umowy, maksymalnie 349 zł.
"""

from __future__ import annotations

# Prowizja Useme (opłata serwisowa).
COMMISSION_RATE = 0.078
COMMISSION_CAP_PLN = 349.0

# Kroki onboardingu freelancera – klucz, tytuł, opis. Klucze służą do
# odhaczania w checkliście (komenda `useme guide`).
ONBOARDING_STEPS: list[tuple[str, str, str]] = [
    ("rejestracja", "Załóż konto freelancera",
     "Rejestracja na useme.com jako osoba fizyczna – bez działalności gospodarczej. "
     "Potwierdź e-mail i uzupełnij dane potrzebne do umowy o dzieło/zlecenie."),
    ("weryfikacja", "Zweryfikuj tożsamość i dane do wypłat",
     "Uzupełnij dane osobowe, numer konta bankowego i dane podatkowe. "
     "Bez tego Useme nie wystawi faktury ani nie wypłaci środków."),
    ("profil", "Zbuduj mocny profil i portfolio",
     "Dodaj zdjęcie, opis specjalizacji, umiejętności i próbki prac (portfolio). "
     "Im konkretniej, tym większa szansa, że zleceniodawca wybierze właśnie Ciebie."),
    ("kategorie", "Wybierz kategorie i obserwuj zlecenia",
     "Ustaw kategorie zgodne z Twoimi umiejętnościami i przeglądaj useme.com/pl/jobs/. "
     "Nowe zlecenia pojawiają się codziennie – reaguj szybko."),
    ("oferta", "Aplikuj: 'Dodaj ofertę' z konkretną propozycją",
     "Wejdź w zlecenie i kliknij 'Dodaj ofertę'. Napisz spersonalizowaną propozycję: "
     "co zrobisz, w jakim czasie, za jaką cenę. Unikaj kopiuj-wklej."),
    ("wycena", "Wyceń pracę z uwzględnieniem opłaty serwisowej",
     "Pamiętaj o opłacie 7,8% (max 349 zł) – wlicz ją w stawkę, by wyjść na swoje. "
     "Użyj `useme calc <kwota>` aby policzyć kwotę netto."),
    ("realizacja", "Zrealizuj zlecenie po akceptacji oferty",
     "Po przyjęciu oferty wykonaj pracę zgodnie z ustaleniami. "
     "Trzymaj się terminu i zakresu – dobra opinia owocuje kolejnymi zleceniami."),
    ("przekazanie", "Przekaż gotową pracę przez Useme",
     "Prześlij efekt przez platformę. Zleceniodawca ma 7 dni na akceptację "
     "lub zgłoszenie poprawek."),
    ("wyplata", "Odbierz wynagrodzenie i fakturę",
     "Po akceptacji środki trafiają na Twoje konto. Useme wystawia fakturę klientowi "
     "i odprowadza podatki – Ty dostajesz rozliczoną wypłatę."),
]


def net_amount(gross: float) -> dict:
    """Zwraca rozbicie: brutto, opłata serwisowa, netto dla freelancera."""
    fee = min(gross * COMMISSION_RATE, COMMISSION_CAP_PLN)
    return {
        "brutto": round(gross, 2),
        "oplata_serwisowa": round(fee, 2),
        "netto_freelancer": round(gross - fee, 2),
        "stawka_efektywna_proc": round((fee / gross * 100) if gross else 0, 2),
    }


def gross_for_target_net(target_net: float) -> float:
    """Ile zafakturować, by 'na rękę' wyszło target_net (uwzględnia 7,8% / cap 349)."""
    # Najpierw zakładamy, że nie przekraczamy capa.
    gross = target_net / (1 - COMMISSION_RATE)
    if gross * COMMISSION_RATE > COMMISSION_CAP_PLN:
        gross = target_net + COMMISSION_CAP_PLN
    return round(gross, 2)
