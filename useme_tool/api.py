"""Klient oficjalnego API Useme (strona zleceniodawcy / rozliczanie freelancerów).

Bazuje na publicznej dokumentacji: https://apidocs.useme.com/
Autoryzacja: token w nagłówku Authorization.
Zasoby: categories, contractors, deals, files.

Używa wyłącznie biblioteki standardowej (urllib) — zero zależności.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

from . import config


class UsemeAPIError(Exception):
    """Błąd zwrócony przez API lub problem z połączeniem."""

    def __init__(self, message: str, status: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status = status
        self.body = body


class UsemeClient:
    """Cienki klient HTTP nad API Useme."""

    def __init__(self, token: str | None = None, base_url: str | None = None, timeout: int = 30):
        self.token = token or config.get_token()
        self.base_url = (base_url or config.get_base_url()).rstrip("/")
        self.timeout = timeout

    # -- niskopoziomowe ----------------------------------------------------
    def _request(self, method: str, path: str, params: dict | None = None,
                 payload: dict | None = None) -> dict | list:
        if not self.token:
            raise UsemeAPIError(
                "Brak tokenu API. Ustaw `USEME_TOKEN` albo `useme config set-token <TOKEN>`."
            )
        url = f"{self.base_url}/{path.lstrip('/')}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"

        data = None
        headers = {
            "Authorization": f"Token {self.token}",
            "Accept": "application/json",
            "User-Agent": "useme-tool/0.1",
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace") if exc.fp else ""
            raise UsemeAPIError(
                f"API zwróciło {exc.code} dla {method} {path}", status=exc.code, body=body
            ) from exc
        except urllib.error.URLError as exc:
            raise UsemeAPIError(f"Problem z połączeniem: {exc.reason}") from exc

    # -- zasoby ------------------------------------------------------------
    def ping(self) -> dict:
        """Szybkie sprawdzenie tokenu/połączenia przez listę kategorii."""
        self.list_categories()
        return {"ok": True, "base_url": self.base_url}

    def list_categories(self) -> dict | list:
        """GET /categories/ – kategorie i podkategorie do tworzenia umów."""
        return self._request("GET", "categories/")

    def list_contractors(self) -> dict | list:
        """GET /contractors/ – lista kontraktorów (freelancerów)."""
        return self._request("GET", "contractors/")

    def create_contractor(self, contractor: dict) -> dict | list:
        """POST /contractors/ – dodanie kontraktora do rozliczenia."""
        return self._request("POST", "contractors/", payload=contractor)

    def list_deals(self) -> dict | list:
        """GET /deals/ – lista umów."""
        return self._request("GET", "deals/")

    def get_deal(self, deal_id: int | str) -> dict | list:
        """GET /deals/{id}/ – szczegóły konkretnej umowy."""
        return self._request("GET", f"deals/{deal_id}/")

    def create_deal(self, deal: dict) -> dict | list:
        """POST /deals/ – utworzenie nowej umowy z freelancerem."""
        return self._request("POST", "deals/", payload=deal)
