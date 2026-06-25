"""Konfiguracja: lokalizacja danych, token API, środowisko (produkcja/sandbox)."""

from __future__ import annotations

import json
import os
from pathlib import Path

# Bazowe adresy API Useme (autoryzacja tokenem w nagłówku Authorization).
PROD_BASE = "https://useme.com/api/1.0"
SANDBOX_BASE = "https://sandbox.useme.com/api/1.0"


def home_dir() -> Path:
    """Katalog z danymi narzędzia. Można nadpisać przez USEME_HOME."""
    raw = os.environ.get("USEME_HOME")
    path = Path(raw).expanduser() if raw else Path.home() / ".useme"
    path.mkdir(parents=True, exist_ok=True)
    return path


def store_path() -> Path:
    return home_dir() / "store.json"


def config_path() -> Path:
    return home_dir() / "config.json"


def load_config() -> dict:
    path = config_path()
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def save_config(cfg: dict) -> None:
    config_path().write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def get_token() -> str | None:
    """Token API: najpierw zmienna środowiskowa, potem plik config."""
    return os.environ.get("USEME_TOKEN") or load_config().get("token")


def get_base_url() -> str:
    """Bazowy URL API. USEME_ENV=sandbox przełącza na piaskownicę."""
    env = (os.environ.get("USEME_ENV") or load_config().get("env") or "prod").lower()
    return SANDBOX_BASE if env in ("sandbox", "test", "dev") else PROD_BASE
