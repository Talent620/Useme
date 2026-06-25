"""Interfejs wiersza poleceń: `python3 -m useme_tool ...` lub `./useme ...`."""

from __future__ import annotations

import argparse
import json
import sys

from . import __version__, config, guide
from . import tasks as T
from .api import UsemeAPIError, UsemeClient

# --- proste kolorowanie (ANSI, bez zależności) ---------------------------
_USE_COLOR = sys.stdout.isatty()


def c(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _USE_COLOR else text


def bold(t: str) -> str: return c(t, "1")
def green(t: str) -> str: return c(t, "32")
def yellow(t: str) -> str: return c(t, "33")
def red(t: str) -> str: return c(t, "31")
def cyan(t: str) -> str: return c(t, "36")
def dim(t: str) -> str: return c(t, "2")


def money(amount: float, currency: str = "PLN") -> str:
    return f"{amount:,.2f} {currency}".replace(",", " ")


# === GUIDE ================================================================
def cmd_guide(args: argparse.Namespace) -> int:
    checklist = T.get_checklist()
    if args.done:
        valid = {k for k, _, _ in guide.ONBOARDING_STEPS}
        if args.done not in valid:
            print(red(f"Nieznany krok '{args.done}'. Dostępne: {', '.join(sorted(valid))}"))
            return 1
        T.set_checklist(args.done, True)
        print(green(f"✓ Odhaczono krok: {args.done}"))
        return 0
    if args.undone:
        T.set_checklist(args.undone, False)
        print(yellow(f"○ Cofnięto krok: {args.undone}"))
        return 0

    print(bold("\n  Jak zarobić na Useme – plan działania\n"))
    done_count = 0
    for key, title, desc in guide.ONBOARDING_STEPS:
        is_done = checklist.get(key, False)
        done_count += is_done
        mark = green("✓") if is_done else dim("○")
        head = f"  {mark} {bold(title)}  {dim('[' + key + ']')}"
        print(head)
        print(dim(f"      {desc}"))
    total = len(guide.ONBOARDING_STEPS)
    print()
    bar = green("█" * done_count) + dim("░" * (total - done_count))
    print(f"  Postęp: {bar} {done_count}/{total}")
    print(dim("\n  Odhacz krok:  useme guide --done <klucz>     (np. useme guide --done rejestracja)"))
    print(dim("  Pełne info:   https://help.useme.com/freelancer\n"))
    return 0


# === CALC =================================================================
def cmd_calc(args: argparse.Namespace) -> int:
    if args.target_net:
        gross = guide.gross_for_target_net(args.amount)
        print(bold("\n  Ile zafakturować, by dostać 'na rękę':"))
        print(f"    Cel netto:        {money(args.amount)}")
        print(f"    Zafakturuj:       {bold(money(gross))}")
        b = guide.net_amount(gross)
        print(dim(f"    (opłata serwisowa: {money(b['oplata_serwisowa'])})\n"))
        return 0
    b = guide.net_amount(args.amount)
    pct = b["stawka_efektywna_proc"]
    print(bold("\n  Rozliczenie zlecenia:"))
    print(f"    Brutto (umowa):    {money(b['brutto'])}")
    fee_note = dim(f"({pct}%, max 349 zł)")
    print(f"    Opłata serwisowa:  {red('- ' + money(b['oplata_serwisowa']))}  {fee_note}")
    print(f"    Netto (Ty):        {green(bold(money(b['netto_freelancer'])))}\n")
    return 0


# === JOBS / PIPELINE ======================================================
_STAGE_COLOR = {
    "lead": dim, "applied": cyan, "won": cyan, "in_progress": yellow,
    "delivered": yellow, "accepted": green, "paid": green,
}


def _print_job(job: dict) -> None:
    color = _STAGE_COLOR.get(job["stage"], lambda x: x)
    stage_tag = color(f"[{job['stage']:<11}]")
    line = f"  #{job['id']:>3} {stage_tag} {bold(job['title'])}"
    if job["amount"]:
        line += f"  {money(job['amount'], job['currency'])}"
    print(line)
    meta = []
    if job["client"]:
        meta.append(f"klient: {job['client']}")
    if job["deadline"]:
        meta.append(f"termin: {job['deadline']}")
    if job["url"]:
        meta.append(job["url"])
    if meta:
        print(dim("        " + "  ·  ".join(meta)))
    if job["notes"]:
        print(dim(f"        ↳ {job['notes']}"))


def cmd_job_add(args: argparse.Namespace) -> int:
    try:
        job = T.add_job(
            title=args.title, client=args.client or "", amount=args.amount or 0.0,
            currency=args.currency, stage=args.stage, deadline=args.deadline or "",
            url=args.url or "", notes=args.notes or "",
        )
    except ValueError as exc:
        print(red(str(exc)))
        return 1
    print(green(f"✓ Dodano zlecenie #{job['id']}: {job['title']}"))
    return 0


def cmd_job_list(args: argparse.Namespace) -> int:
    jobs = T.list_jobs(stage=args.stage)
    if not jobs:
        print(dim("  Brak zleceń. Dodaj: useme job add \"Tytuł\" --amount 500"))
        return 0
    print(bold(f"\n  Zlecenia ({len(jobs)}):\n"))
    for job in jobs:
        _print_job(job)
    print()
    return 0


def cmd_job_set(args: argparse.Namespace) -> int:
    fields = {k: v for k, v in {
        "stage": args.stage, "amount": args.amount, "deadline": args.deadline,
        "client": args.client, "url": args.url, "notes": args.notes, "title": args.title,
    }.items() if v is not None}
    if not fields:
        print(yellow("Nic do zmiany. Podaj np. --stage paid"))
        return 1
    try:
        job = T.update_job(args.id, **fields)
    except (KeyError, ValueError) as exc:
        print(red(str(exc)))
        return 1
    print(green(f"✓ Zaktualizowano #{job['id']}"))
    _print_job(job)
    return 0


def cmd_job_rm(args: argparse.Namespace) -> int:
    if T.remove_job(args.id):
        print(green(f"✓ Usunięto zlecenie #{args.id}"))
        return 0
    print(red(f"Brak zlecenia o id {args.id}"))
    return 1


def cmd_status(args: argparse.Namespace) -> int:
    s = T.summary()
    print(bold("\n  Panel kontrolny Useme\n"))
    print(f"  Zleceń łącznie:     {s['total_jobs']}")
    print(f"  W toku (pipeline):  {bold(money(s['pipeline_value']))}")
    print(f"  Zarobione (paid):   {green(bold(money(s['earned_paid'])))}\n")
    print(bold("  Wg etapu:"))
    for stage in T.STAGES:
        info = s["by_stage"][stage]
        if info["count"]:
            color = _STAGE_COLOR.get(stage, lambda x: x)
            print(f"    {color(f'{stage:<12}')} {info['count']:>2} szt.  "
                  f"{dim(money(info['amount']))}")
    overdue = T.overdue_jobs()
    if overdue:
        print(red(f"\n  ⚠ Po terminie ({len(overdue)}):"))
        for job in overdue:
            print(red(f"    #{job['id']} {job['title']} — termin {job['deadline']}"))
    # Onboarding
    checklist = T.get_checklist()
    done = sum(1 for k, _, _ in guide.ONBOARDING_STEPS if checklist.get(k))
    total = len(guide.ONBOARDING_STEPS)
    print(f"\n  Onboarding: {done}/{total} kroków  {dim('(useme guide)')}\n")
    return 0


# === API =================================================================
def _client(args: argparse.Namespace) -> UsemeClient:
    return UsemeClient(token=getattr(args, "token", None))


def _dump(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def cmd_api_ping(args: argparse.Namespace) -> int:
    try:
        res = _client(args).ping()
    except UsemeAPIError as exc:
        print(red(f"✗ {exc}"))
        if exc.body:
            print(dim(exc.body[:500]))
        return 1
    print(green(f"✓ Połączono z API ({res['base_url']})"))
    return 0


def cmd_api_categories(args: argparse.Namespace) -> int:
    return _api_get(args, lambda cl: cl.list_categories())


def cmd_api_contractors(args: argparse.Namespace) -> int:
    return _api_get(args, lambda cl: cl.list_contractors())


def cmd_api_deals(args: argparse.Namespace) -> int:
    if args.id:
        return _api_get(args, lambda cl: cl.get_deal(args.id))
    return _api_get(args, lambda cl: cl.list_deals())


def _api_get(args, fn) -> int:
    try:
        _dump(fn(_client(args)))
    except UsemeAPIError as exc:
        print(red(f"✗ {exc}"))
        if exc.body:
            print(dim(exc.body[:500]))
        return 1
    return 0


# === CONFIG ==============================================================
def cmd_config(args: argparse.Namespace) -> int:
    cfg = config.load_config()
    if args.action == "set-token":
        cfg["token"] = args.value
        config.save_config(cfg)
        print(green("✓ Token zapisany w " + str(config.config_path())))
    elif args.action == "set-env":
        cfg["env"] = args.value
        config.save_config(cfg)
        print(green(f"✓ Środowisko: {args.value} ({config.get_base_url()})"))
    elif args.action == "show":
        token = config.get_token()
        print(f"  Środowisko:  {config.get_base_url()}")
        print(f"  Token:       {(token[:6] + '…') if token else red('brak')}")
        print(f"  Dane:        {config.home_dir()}")
    return 0


# === PARSER ==============================================================
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="useme",
        description="Narzędzie do połączenia z Useme i kontroli zadań freelancera.",
    )
    p.add_argument("--version", action="version", version=f"useme-tool {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    # guide
    g = sub.add_parser("guide", help="Przewodnik 'jak zarobić' + checklista onboardingu")
    g.add_argument("--done", metavar="KLUCZ", help="Odhacz krok onboardingu")
    g.add_argument("--undone", metavar="KLUCZ", help="Cofnij odhaczenie kroku")
    g.set_defaults(func=cmd_guide)

    # calc
    cal = sub.add_parser("calc", help="Kalkulator opłaty serwisowej (7,8%, max 349 zł)")
    cal.add_argument("amount", type=float, help="Kwota (brutto umowy lub cel netto)")
    cal.add_argument("--target-net", action="store_true",
                     help="Potraktuj kwotę jako cel 'na rękę' i policz, ile zafakturować")
    cal.set_defaults(func=cmd_calc)

    # status
    st = sub.add_parser("status", help="Panel kontrolny: pipeline, zarobki, terminy")
    st.set_defaults(func=cmd_status)

    # job
    j = sub.add_parser("job", help="Zarządzanie zleceniami (pipeline)")
    jsub = j.add_subparsers(dest="job_cmd", required=True)

    ja = jsub.add_parser("add", help="Dodaj zlecenie")
    ja.add_argument("title")
    ja.add_argument("--client")
    ja.add_argument("--amount", type=float)
    ja.add_argument("--currency", default="PLN")
    ja.add_argument("--stage", default="lead", choices=T.STAGES)
    ja.add_argument("--deadline", help="RRRR-MM-DD")
    ja.add_argument("--url")
    ja.add_argument("--notes")
    ja.set_defaults(func=cmd_job_add)

    jl = jsub.add_parser("list", help="Lista zleceń")
    jl.add_argument("--stage", choices=T.STAGES)
    jl.set_defaults(func=cmd_job_list)

    js = jsub.add_parser("set", help="Zmień zlecenie (np. przesuń etap)")
    js.add_argument("id", type=int)
    js.add_argument("--stage", choices=T.STAGES)
    js.add_argument("--amount", type=float)
    js.add_argument("--deadline")
    js.add_argument("--client")
    js.add_argument("--url")
    js.add_argument("--notes")
    js.add_argument("--title")
    js.set_defaults(func=cmd_job_set)

    jr = jsub.add_parser("rm", help="Usuń zlecenie")
    jr.add_argument("id", type=int)
    jr.set_defaults(func=cmd_job_rm)

    # api
    a = sub.add_parser("api", help="Klient oficjalnego API Useme (zleceniodawca)")
    a.add_argument("--token", help="Token API (nadpisuje config/env)")
    asub = a.add_subparsers(dest="api_cmd", required=True)
    asub.add_parser("ping", help="Sprawdź połączenie i token").set_defaults(func=cmd_api_ping)
    asub.add_parser("categories", help="Pobierz kategorie").set_defaults(func=cmd_api_categories)
    asub.add_parser("contractors", help="Lista kontraktorów").set_defaults(func=cmd_api_contractors)
    ad = asub.add_parser("deals", help="Lista umów / szczegóły umowy")
    ad.add_argument("--id", help="ID konkretnej umowy")
    ad.set_defaults(func=cmd_api_deals)

    # config
    cf = sub.add_parser("config", help="Konfiguracja tokenu i środowiska")
    cfsub = cf.add_subparsers(dest="action", required=True)
    cft = cfsub.add_parser("set-token", help="Zapisz token API")
    cft.add_argument("value")
    cfe = cfsub.add_parser("set-env", help="Ustaw środowisko (prod|sandbox)")
    cfe.add_argument("value", choices=["prod", "sandbox"])
    cfsub.add_parser("show", help="Pokaż aktualną konfigurację")
    cf.set_defaults(func=cmd_config)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
