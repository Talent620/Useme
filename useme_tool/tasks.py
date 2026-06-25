"""Lokalny tracker zleceń i checklisty onboardingu (kontrola: co trzeba zrobić).

Dane trzymane w JSON w katalogu USEME_HOME (domyślnie ~/.useme/store.json).
"""

from __future__ import annotations

import json
from datetime import date, datetime

from . import config

# Etapy pipeline'u zlecenia – od namiaru do wypłaty.
STAGES = ["lead", "applied", "won", "in_progress", "delivered", "accepted", "paid"]
ACTIVE_STAGES = {"lead", "applied", "won", "in_progress", "delivered"}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_store() -> dict:
    path = config.store_path()
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
    else:
        data = {}
    data.setdefault("jobs", [])
    data.setdefault("checklist", {})
    data.setdefault("seq", 0)
    return data


def save_store(data: dict) -> None:
    config.store_path().write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# -- checklista onboardingu ------------------------------------------------
def set_checklist(key: str, done: bool) -> None:
    data = load_store()
    data["checklist"][key] = done
    save_store(data)


def get_checklist() -> dict:
    return load_store()["checklist"]


# -- zlecenia --------------------------------------------------------------
def add_job(title: str, client: str = "", amount: float = 0.0, currency: str = "PLN",
            stage: str = "lead", deadline: str = "", url: str = "", notes: str = "") -> dict:
    if stage not in STAGES:
        raise ValueError(f"Nieznany etap '{stage}'. Dozwolone: {', '.join(STAGES)}")
    data = load_store()
    data["seq"] += 1
    job = {
        "id": data["seq"],
        "title": title,
        "client": client,
        "amount": float(amount),
        "currency": currency,
        "stage": stage,
        "deadline": deadline,
        "url": url,
        "notes": notes,
        "created": _now(),
        "updated": _now(),
    }
    data["jobs"].append(job)
    save_store(data)
    return job


def _find(data: dict, job_id: int) -> dict | None:
    return next((j for j in data["jobs"] if j["id"] == job_id), None)


def update_job(job_id: int, **fields) -> dict:
    data = load_store()
    job = _find(data, job_id)
    if not job:
        raise KeyError(f"Brak zlecenia o id {job_id}")
    if "stage" in fields and fields["stage"] not in STAGES:
        raise ValueError(f"Nieznany etap '{fields['stage']}'. Dozwolone: {', '.join(STAGES)}")
    for key, value in fields.items():
        if value is not None and key in job:
            job[key] = float(value) if key == "amount" else value
    job["updated"] = _now()
    save_store(data)
    return job


def remove_job(job_id: int) -> bool:
    data = load_store()
    before = len(data["jobs"])
    data["jobs"] = [j for j in data["jobs"] if j["id"] != job_id]
    save_store(data)
    return len(data["jobs"]) < before


def list_jobs(stage: str | None = None) -> list[dict]:
    jobs = load_store()["jobs"]
    if stage:
        jobs = [j for j in jobs if j["stage"] == stage]
    order = {s: i for i, s in enumerate(STAGES)}
    return sorted(jobs, key=lambda j: (order.get(j["stage"], 99), j["id"]))


def overdue_jobs(today: str | None = None) -> list[dict]:
    """Aktywne zlecenia z przekroczonym terminem."""
    ref = today or date.today().isoformat()
    out = []
    for job in list_jobs():
        if job["stage"] in ACTIVE_STAGES and job["deadline"] and job["deadline"] < ref:
            out.append(job)
    return out


def summary() -> dict:
    """Podsumowanie pipeline'u: liczby i wartości wg etapu."""
    jobs = list_jobs()
    by_stage = {s: {"count": 0, "amount": 0.0} for s in STAGES}
    for job in jobs:
        bucket = by_stage[job["stage"]]
        bucket["count"] += 1
        bucket["amount"] += job["amount"]
    pipeline_value = sum(j["amount"] for j in jobs if j["stage"] in ACTIVE_STAGES)
    earned = sum(j["amount"] for j in jobs if j["stage"] == "paid")
    return {
        "total_jobs": len(jobs),
        "by_stage": by_stage,
        "pipeline_value": round(pipeline_value, 2),
        "earned_paid": round(earned, 2),
    }
