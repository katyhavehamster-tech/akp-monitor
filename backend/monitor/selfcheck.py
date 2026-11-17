"""Самоперевірка на синтетичному наборі організаторів:
1) сигнали системи порівнюються з ключем kliuch/ochikuvani-sygnaly.csv;
2) звіт для Порталу порівнюється з еталоном zvit_portal_2026_h1.csv.
"""
import csv
from pathlib import Path

from django.conf import settings

from . import rules as R
from .models import Program, ReportingPeriod

DS = Path(settings.BASE_DIR) / "data" / "dataset"


def _read(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def run_selfcheck():
    period = ReportingPeriod.objects.get(code="2026-Q2")
    flags = R.compute_flags(period)
    got = {(f["code"], f["object"], f["id"]) for f in flags}
    key = {(r["kod"], r["obiekt"], r["id"]) for r in _read(DS / "kliuch" / "ochikuvani-sygnaly.csv")}
    missing = sorted(key - got)
    extra = sorted(got - key)

    rows = R.portal_report(Program.objects.first(), 2026, 1)
    etalon = {r["zakhid_id"]: r for r in _read(DS / "dani" / "zvit_portal_2026_h1.csv")}
    diffs = []
    for r in rows:
        e = etalon.get(r["zakhid_id"])
        if not e:
            diffs.append({"zakhid_id": r["zakhid_id"], "field": "*", "ours": "є", "etalon": "немає"})
            continue
        for k, v in e.items():
            if str(r.get(k, "")) != v:
                diffs.append({"zakhid_id": r["zakhid_id"], "field": k, "ours": str(r.get(k, "")), "etalon": v})
    return {
        "flags": {"expected": len(key), "found": len(got), "matched": len(key & got),
                  "missing": [list(x) for x in missing], "extra": [list(x) for x in extra],
                  "ok": not missing and not extra},
        "report": {"rows": len(rows), "etalon_rows": len(etalon), "differences": diffs[:50],
                   "n_differences": len(diffs), "ok": not diffs and len(rows) == len(etalon)},
    }
