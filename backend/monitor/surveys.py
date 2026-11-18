"""Порівняння результатів двох Google Форм (CSV-експорт «Відповіді → Завантажити»).

Принципи:
- електронні адреси не зберігаються: колонки з поштою і позначкою часу відкидаються під час імпорту;
- якщо в якійсь клітинці трапиться адреса пошти, її значення замінюється на «[приховано]»;
- результати показуються лише для груп, не менших за мінімальний розмір (SystemSettings.min_survey_group).
"""
from __future__ import annotations

import csv
import io
import re
from collections import Counter

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
DROP_HEADERS = ("позначка часу", "timestamp", "електронн", "email", "e-mail", "пошт", "адреса ел")
MULTI_SEP = ";"


MAX_SURVEY_BYTES = 5 * 1024 * 1024


def parse_csv(raw: bytes) -> dict:
    if len(raw) > MAX_SURVEY_BYTES:
        raise ValueError("Файл перевищує допустимий розмір (5 МБ)")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1251")
    reader = csv.reader(io.StringIO(text))
    table = [r for r in reader if any(c.strip() for c in r)]
    if not table:
        raise ValueError("Порожній файл")
    header = [h.strip() for h in table[0]]
    keep, dropped = [], []
    for i, h in enumerate(header):
        hl = h.lower()
        if any(k in hl for k in DROP_HEADERS):
            dropped.append(h)
        else:
            keep.append(i)
    answers = []
    for r in table[1:]:
        row = {}
        for i in keep:
            v = r[i].strip() if i < len(r) else ""
            row[header[i]] = "[приховано]" if EMAIL_RE.search(v) else v
        answers.append(row)
    return {"questions": [header[i] for i in keep], "answers": answers, "dropped": dropped}


def _is_number(v):
    try:
        float(v.replace(",", "."))
        return True
    except ValueError:
        return False


def question_kind(values: list[str]) -> str:
    vals = [v for v in values if v]
    if not vals:
        return "empty"
    if all(_is_number(v) for v in vals):
        return "scale"
    if len(set(vals)) > max(10, 0.5 * len(vals)):
        return "text"
    return "choice"


def _dist(values):
    vals = [v for v in values if v]
    c = Counter(vals)
    n = len(vals)
    return {k: {"n": c[k], "pct": round(100 * c[k] / n, 1)} for k in c}, n


def compare(a: dict, b: dict, min_group: int = 5, filter_q: str | None = None, filter_v: str | None = None) -> dict:
    """a, b: {"title", "questions", "answers"}. Повертає порівняння за спільними питаннями."""
    def filt(s):
        if filter_q and filter_v:
            return [r for r in s["answers"] if r.get(filter_q) == filter_v]
        return s["answers"]

    ra, rb = filt(a), filt(b)
    common = [q for q in a["questions"] if q in b["questions"]]
    only_a = [q for q in a["questions"] if q not in b["questions"]]
    only_b = [q for q in b["questions"] if q not in a["questions"]]
    hidden = len(ra) < min_group or len(rb) < min_group
    result = {"n_a": len(ra), "n_b": len(rb), "min_group": min_group, "hidden": hidden,
              "only_a": only_a, "only_b": only_b, "questions": []}
    if hidden:
        return result
    for q in common:
        va = [r.get(q, "") for r in ra]
        vb = [r.get(q, "") for r in rb]
        kind = question_kind(va + vb)
        item = {"question": q, "kind": kind}
        if kind == "scale":
            fa = [float(v.replace(",", ".")) for v in va if v]
            fb = [float(v.replace(",", ".")) for v in vb if v]
            ma = round(sum(fa) / len(fa), 2) if fa else None
            mb = round(sum(fb) / len(fb), 2) if fb else None
            da, _ = _dist(va)
            db, _ = _dist(vb)
            keys = sorted(set(da) | set(db), key=lambda x: float(x.replace(",", ".")))
            item.update({"mean_a": ma, "mean_b": mb,
                         "delta": round(mb - ma, 2) if ma is not None and mb is not None else None,
                         "options": [{"option": k, "a": da.get(k, {"pct": 0, "n": 0}), "b": db.get(k, {"pct": 0, "n": 0}),
                                      "delta_pp": round(db.get(k, {"pct": 0})["pct"] - da.get(k, {"pct": 0})["pct"], 1)}
                                     for k in keys]})
        elif kind == "choice":
            # варіанти з чекбоксів Google Форми розділені «;» або «, »
            def split(vals):
                out = []
                for v in vals:
                    out += [x.strip() for x in v.split(MULTI_SEP)] if MULTI_SEP in v else [v]
                return out
            da, _ = _dist(split(va))
            db, _ = _dist(split(vb))
            keys = sorted(set(da) | set(db), key=lambda k: -(da.get(k, {"n": 0})["n"] + db.get(k, {"n": 0})["n"]))
            item["options"] = [{"option": k, "a": da.get(k, {"pct": 0, "n": 0}), "b": db.get(k, {"pct": 0, "n": 0}),
                                "delta_pp": round(db.get(k, {"pct": 0})["pct"] - da.get(k, {"pct": 0})["pct"], 1)}
                               for k in keys]
        elif kind == "text":
            item["answers_a"] = [v for v in va if v]
            item["answers_b"] = [v for v in vb if v]
        result["questions"].append(item)
    return result


def group_options(a: dict, b: dict) -> list[dict]:
    """Питання, за якими можна фільтрувати (варіанти вибору, спільні для обох форм)."""
    out = []
    for q in a["questions"]:
        if q not in b["questions"]:
            continue
        vals = [r.get(q, "") for r in a["answers"] + b["answers"]]
        if question_kind(vals) == "choice":
            out.append({"question": q, "values": sorted({v for v in vals if v and MULTI_SEP not in v})})
    return out
