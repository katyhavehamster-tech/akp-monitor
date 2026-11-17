"""Аналітичне ядро: сигнали Risk Flags, звіт для Порталу НАЗК, моніторинг,
ризик невиконання, рекомендації, аналітична довідка.

Усі висновки — детерміновані функції від даних і правил із rules.yaml.
Жодних викликів моделей ШІ: так висновок завжди можна пояснити і відтворити.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path

import yaml

from .models import (DeadlineChange, Evidence, Execution, Measure, Program, ReportingPeriod, Risk,
                     SystemSettings, Unit)

RULES_PATH = Path(__file__).with_name("rules.yaml")

PORTAL_DONE = "Виконано"
PORTAL_PARTIAL = "Частково виконано"
PORTAL_NOT_DONE = "Не виконано"
PORTAL_NOT_DUE = "Строк виконання заходу не настав"


@lru_cache
def rules() -> dict:
    with open(RULES_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def flag_params(code):
    return rules()["flags"][code].get("params", {})


def flag_catalog():
    out = []
    for code, r in rules()["flags"].items():
        p = r.get("params", {})
        out.append({"code": code, "title": r["title"], "description": r["description"],
                    "rule": r["rule"].format(**p), "severity": r["severity"], "params": p})
    return out


# ---------------------------------------------------------------- знімок даних
@dataclass
class Snap:
    """Стан одного заходу на кінець періоду — усе, що потрібно правилам."""
    measure: Measure
    execution: Execution | None
    evidence: list = field(default_factory=list)
    postponements: list = field(default_factory=list)

    @property
    def m(self):
        return self.measure

    @property
    def status(self):
        return self.execution.status if self.execution else Execution.Status.NE_ROZPOCHATO

    @property
    def opys(self):
        return (self.execution.result_text if self.execution else "") or ""

    @property
    def fakt(self):
        return self.execution.fact_date if self.execution else None

    @property
    def ind_fakt(self):
        return self.execution.indicator_fact if self.execution else None


def snapshot(period: ReportingPeriod, measures=None) -> list[Snap]:
    measures = measures if measures is not None else Measure.objects.all()
    measures = list(measures.select_related("section", "risk", "responsible_unit").prefetch_related("co_units"))
    ids = [m.id for m in measures]
    ex = {e.measure_id: e for e in Execution.objects.filter(period=period, measure_id__in=ids)
          .select_related("entered_by", "approved_by")}
    ev = defaultdict(list)
    # Підтвердження накопичуються: беремо всі, подані за цей і попередні періоди.
    from django.db.models import Q
    for e in Evidence.objects.filter(Q(period__isnull=True) | Q(period__end__lte=period.end), measure_id__in=ids):
        ev[e.measure_id].append(e)
    pp = defaultdict(list)
    for d in DeadlineChange.objects.filter(measure_id__in=ids, decision_date__lte=period.window_end):
        pp[d.measure_id].append(d)
    return [Snap(m, ex.get(m.id), ev[m.id], pp[m.id]) for m in measures]


# ---------------------------------------------------------------- стан для Порталу
def strok_ne_nastav(s: Snap, period_end: date) -> bool:
    return s.m.strok_type == "data" and s.m.strok_date and s.m.strok_date > period_end


def portal_state(s: Snap, period_end: date) -> str:
    if strok_ne_nastav(s, period_end) and s.status != "vykonano":
        return PORTAL_NOT_DUE
    return {"vykonano": PORTAL_DONE, "chastkovo": PORTAL_PARTIAL}.get(s.status, PORTAL_NOT_DONE)


def portal_fact_date(s: Snap, period_end: date) -> str:
    if s.m.strok_type in ("postiino", "periodychno"):
        return period_end.isoformat()
    if s.status == "vykonano" and s.fakt:
        return s.fakt.isoformat()
    return ""


# ---------------------------------------------------------------- подібність тексту (RF4)
def stems(text: str) -> set[str]:
    p = flag_params("RF4")
    words = re.findall(r"[а-щьюяґєіїʼ'a-z]+", text.lower())
    return {w[: p.get("stem_len", 5)] for w in words if len(w) >= p.get("min_word_len", 4)}


def similarity(a: str, b: str) -> float:
    sa, sb = stems(a), stems(b)
    return len(sa & sb) / len(sa | sb) if sa and sb else 0.0


# ---------------------------------------------------------------- Risk Flags
def _flag(code, obj, obj_id, explanation, unit=None, measure=None):
    r = rules()["flags"][code]
    return {"code": code, "object": obj, "id": obj_id, "title": r["title"], "signal": r["description"],
            "explanation": explanation, "severity": r["severity"],
            "rule": r["rule"].format(**r.get("params", {})),
            "unit": unit, "measure_content": measure.content if measure else None}


def compute_flags(period: ReportingPeriod, snaps: list[Snap] | None = None) -> list[dict]:
    snaps = snaps if snaps is not None else snapshot(period)
    end = period.end
    res = []
    overdue_by_unit = defaultdict(list)
    thr = flag_params("RF3")["formal_closure_threshold"]
    sim_thr = flag_params("RF4")["similarity_threshold"]
    statuses = dict(Execution.Status.choices)

    for s in snaps:
        m, st, unit = s.m, s.status, s.m.responsible_unit.code
        F = lambda code, expl: res.append(_flag(code, "zakhid", m.code, expl, unit, m))  # noqa: E731
        if m.strok_type == "data" and m.strok_date and m.strok_date <= end and st != "vykonano":
            F("RF1", f"строк {m.strok_date.isoformat()}, статус «{statuses[st]}»")
            overdue_by_unit[unit].append(m.code)
        if st in ("vykonano", "chastkovo") and not s.evidence:
            F("RF2", "підтвердних матеріалів: 0")
        if m.section.code == "R2" and st == "vykonano" and m.risk:
            r = m.risk
            v = r.value_on(end)
            gap = r.target - r.baseline
            prog = (v - r.baseline) / gap if (gap and v is not None) else 1
            if prog < thr:
                F("RF3", f"ризик {r.code}: {_num(r.baseline)} → {_num(v)} при цілі {_num(r.target)} "
                         f"(пройдено {prog:.0%} шляху)")
        op = s.opys
        if st in ("vykonano", "chastkovo") and op and not re.search(r"\d", op) and "http" not in op:
            p = similarity(op, m.content)
            if p >= sim_thr:
                F("RF4", f"подібність опису до змісту {p:.2f}, чисел і посилань немає")
        if st in ("vykonano", "chastkovo") and m.indicator_target is not None and s.ind_fakt is not None:
            due = m.strok_type != "data" or (m.strok_date and m.strok_date <= end)
            if due and s.ind_fakt < m.indicator_target:
                F("RF5", f"індикатор {_num(s.ind_fakt)} при цілі {_num(m.indicator_target)} {m.indicator_unit}, "
                         f"статус «{statuses[st]}»")
        if s.fakt and s.fakt > end:
            F("RF7a", f"фактична дата {s.fakt.isoformat()} після {end.isoformat()}")
        if m.strok_type == "data" and s.fakt and s.evidence and all(e.doc_date > s.fakt for e in s.evidence):
            first = min(e.doc_date for e in s.evidence)
            F("RF7b", f"найраніший документ від {first.isoformat()} при фактичній даті {s.fakt.isoformat()}")
        ps = portal_state(s, end)
        if ps == PORTAL_NOT_DONE and not op:
            F("RF7c", "поле «Опис результату… або пояснення причин невиконання» порожнє")
        if ps == PORTAL_NOT_DUE and op:
            F("RF7e", f"строк {m.strok_date.isoformat()}, опис заповнено")

    p6 = flag_params("RF6")
    for s in sorted(snaps, key=lambda x: x.m.code):
        n = len(s.postponements)
        if n >= p6["max_postponements"]:
            res.append(_flag("RF6", "zakhid", s.m.code, f"строк переносили {n} рази",
                             s.m.responsible_unit.code, s.m))
    for u, ids in sorted(overdue_by_unit.items()):
        if len(ids) >= p6["max_overdue_per_unit"]:
            res.append(_flag("RF6", "pidrozdil", u, f"прострочені заходи: {', '.join(ids)}", u))

    covered = {s.m.risk_id for s in snaps if s.m.risk_id}
    for r in Risk.objects.all():
        if r.id not in covered and r.level in ("високий", "критичний"):
            res.append(_flag("RF7d", "ryzyk", r.code, f"рівень «{r.level}», заходів 0",
                             r.owner_unit.code if r.owner_unit else None))
    return res


def _num(v):
    if v is None:
        return "—"
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


# ---------------------------------------------------------------- звіт для Порталу
def portal_report(program: Program, year: int, half: int) -> list[dict]:
    """Звіт за півріччя у структурі Порталу доброчесності.
    Береться стан заходів на кінець півріччя — останній квартал півріччя (Q2 або Q4)."""
    period = ReportingPeriod.objects.get(year=year, quarter=2 if half == 1 else 4)
    end = period.half_end
    snaps = snapshot(period, Measure.objects.filter(program=program))
    flags = compute_flags(period, snaps)
    by_m = defaultdict(list)
    for f in flags:
        if f["object"] == "zakhid":
            by_m[f["id"]].append(f["code"])
    rows = []
    for s in snaps:
        st = portal_state(s, end)
        rows.append({
            "rozdil_portal": s.m.section.portal_name,
            "nomer": s.m.number,
            "zakhid_id": s.m.code,
            "opys_zakhodu": s.m.content,
            "naimenuvannia_pidrozdilu": s.m.responsible_unit.name,
            "zaplanovanyi_strok": s.m.strok_text,
            "faktychnyi_strok_vykonannia": portal_fact_date(s, end),
            "stan_vykonannia": st,
            "opys_rezultatu_abo_prychyn": "" if st == PORTAL_NOT_DUE else s.opys,
            "pidtverdni_materialy": "; ".join(e.title for e in sorted(s.evidence, key=lambda e: e.code)),
            "sluzhbove_sygnaly_pered_perenesenniam": ", ".join(by_m.get(s.m.code, [])),
        })
    return rows


REPORT_COLUMNS = [
    ("rozdil_portal", "Розділ"),
    ("nomer", "№"),
    ("zakhid_id", "Код заходу (службове)"),
    ("opys_zakhodu", "Опис заходу"),
    ("naimenuvannia_pidrozdilu", "Найменування структурного підрозділу, відповідального за виконання заходу"),
    ("zaplanovanyi_strok", "Запланований строк виконання заходу"),
    ("faktychnyi_strok_vykonannia", "Фактичний строк виконання"),
    ("stan_vykonannia", "Стан виконання"),
    ("opys_rezultatu_abo_prychyn", "Опис результату виконання заходу або пояснення причин невиконання"),
    ("pidtverdni_materialy", "Підтвердні матеріали"),
    ("sluzhbove_sygnaly_pered_perenesenniam", "Сигнали перед перенесенням (службове)"),
]


# ---------------------------------------------------------------- моніторинг
def monitoring(period: ReportingPeriod, snaps: list[Snap]) -> dict:
    end = period.end
    total = len(snaps)
    by_status = Counter(s.status for s in snaps)
    portal = Counter(portal_state(s, end) for s in snaps)
    postponed = sum(1 for s in snaps if s.postponements)
    overdue = sum(1 for s in snaps if s.m.strok_type == "data" and s.m.strok_date and s.m.strok_date <= end
                  and s.status != "vykonano")
    dated_done = [s for s in snaps if s.status == "vykonano" and s.m.strok_type == "data" and s.fakt]
    on_time = sum(1 for s in dated_done if s.fakt <= s.m.strok_date)
    late = len(dated_done) - on_time
    entered = sum(1 for s in snaps if s.execution and s.execution.entered_at)
    approved = sum(1 for s in snaps if s.execution and s.execution.approval == "approved")

    def pct(n):
        return round(100 * n / total, 1) if total else 0.0

    return {
        "total": total,
        "counts": {
            "vykonano": by_status["vykonano"], "chastkovo": by_status["chastkovo"],
            "ne_vykonano": by_status["ne_vykonano"], "v_roboti": by_status["v_roboti"],
            "ne_rozpochato": by_status["ne_rozpochato"], "not_due": portal[PORTAL_NOT_DUE],
            "portal_not_done": portal[PORTAL_NOT_DONE], "postponed": postponed, "overdue": overdue,
            "done_on_time": on_time, "done_late": late, "entered": entered, "approved": approved,
        },
        "percent": {
            "vykonano": pct(by_status["vykonano"]), "chastkovo": pct(by_status["chastkovo"]),
            "ne_vykonano": pct(portal[PORTAL_NOT_DONE]), "v_roboti": pct(by_status["v_roboti"]),
            "ne_rozpochato": pct(by_status["ne_rozpochato"]), "postponed": pct(postponed),
            "overdue": pct(overdue), "not_due": pct(portal[PORTAL_NOT_DUE]),
            "on_time_of_dated_done": round(100 * on_time / len(dated_done), 1) if dated_done else None,
            "entered": pct(entered), "approved": pct(approved),
        },
        "portal_states": dict(portal),
    }


def breakdown(period: ReportingPeriod, snaps: list[Snap], key: str) -> list[dict]:
    """Виконання за розділами / підрозділами. Без рейтингування: порядок за кодом."""
    groups = defaultdict(list)
    names = {}
    for s in snaps:
        if key == "section":
            k, n = s.m.section.code, s.m.section.portal_name
        else:
            k, n = s.m.responsible_unit.code, s.m.responsible_unit.name
        groups[k].append(s)
        names[k] = n
    out = []
    for k in sorted(groups):
        mon = monitoring(period, groups[k])
        out.append({"code": k, "name": names[k], **mon})
    return out


def nonexecution_risk(s: Snap, today: date, overdue_units: set) -> dict:
    cfg = rules()["nonexecution_risk"]
    par = cfg["params"]
    pts, reasons = 0, []

    def add(key):
        nonlocal pts
        pts += cfg[key]["points"]
        reasons.append({"points": cfg[key]["points"], "text": cfg[key]["text"].format(**par)})

    if s.status == "vykonano":
        return {"score": 0, "level": "низький", "reasons": []}
    dl = s.m.current_deadline if s.m.strok_type == "data" else None
    if s.m.strok_type == "data" and s.m.strok_date and s.m.strok_date < today:
        add("overdue")
    elif dl and 0 <= (dl - today).days <= par["due_soon_days"]:
        add("due_soon_not_started" if s.status == "ne_rozpochato" else "due_soon_in_progress")
    n = len(s.postponements)
    if n >= 2:
        add("postponed_twice")
    elif n == 1:
        add("postponed_once")
    if s.m.responsible_unit.code in overdue_units and not (s.m.strok_date and s.m.strok_date < today):
        add("unit_has_overdue")
    if not s.execution or not s.execution.entered_at:
        add("no_entry")
    level = "високий" if pts >= par["high_from"] else "середній" if pts >= par["medium_from"] else "низький"
    return {"score": pts, "level": level, "reasons": reasons}


def risk_state(period: ReportingPeriod, snaps: list[Snap]) -> list[dict]:
    """Стан корупційних ризиків: чи зменшується ризик, а не скільки заходів закрито."""
    by_risk = defaultdict(list)
    for s in snaps:
        if s.m.risk_id:
            by_risk[s.m.risk_id].append(s)
    out = []
    for r in Risk.objects.select_related("owner_unit").prefetch_related("measurements"):
        ms = by_risk.get(r.id, [])
        v = r.value_on(period.end)
        prog = r.progress_on(period.end)
        done = sum(1 for s in ms if s.status == "vykonano")
        if not ms:
            verdict = "без заходів"
        elif prog is None:
            verdict = "немає вимірювань"
        elif prog >= 0.5:
            verdict = "зменшується"
        elif prog >= 0.1:
            verdict = "повільно зменшується"
        else:
            verdict = "не змінюється"
        out.append({
            "code": r.code, "name": r.name, "process": r.process, "level": r.level, "score": r.score,
            "indicator": r.indicator, "unit": r.indicator_unit, "direction": r.direction,
            "baseline": r.baseline, "current": v, "target": r.target, "progress": prog,
            "measures_total": len(ms), "measures_done": done, "verdict": verdict,
            "owner_unit": r.owner_unit.code if r.owner_unit else None,
            "history": [{"date": m.date.isoformat(), "value": m.value} for m in r.measurements.all()],
            "measures": [s.m.code for s in ms],
        })
    return out


# ---------------------------------------------------------------- рекомендації
def generate_recommendations(period: ReportingPeriod, flags: list[dict]) -> list[dict]:
    """Явні правила: сигнал → запропонована управлінська дія з поясненням підстав."""
    cfg = rules()["recommendations"]
    units = {u.code: u for u in Unit.objects.all()}
    risks = {r.code: r for r in Risk.objects.all()}
    by_code = defaultdict(list)
    for f in flags:
        by_code[f["code"]].append(f)
    out = []

    def rec(rule, key, unit_code, basis, **fmt):
        c = cfg[rule]
        out.append({"key": f"{period.code}:{rule}:{key}", "rule": rule, "priority": c["priority"],
                    "title": c["when"], "proposed_action": c["action"].format(**fmt),
                    "target_unit": unit_code, "basis": basis})

    for f in by_code["RF6"]:
        if f["object"] == "pidrozdil":
            rec("REC-UNIT-OVERDUE", f["id"], f["id"], {"flags": [f]},
                unit=units[f["id"]].name, measures=f["explanation"].split(": ", 1)[1])
        else:
            rec("REC-POSTPONED", f["id"], f["unit"], {"flags": [f]}, measures=f["id"])
    rf3_by_risk = defaultdict(list)
    for f in by_code["RF3"]:
        rcode = f["explanation"].split(":")[0].replace("ризик ", "")
        rf3_by_risk[rcode].append(f)
    for rcode, fl in sorted(rf3_by_risk.items()):
        r = risks[rcode]
        prog = r.progress_on(period.end)
        rec("REC-RISK-FORMAL", rcode, r.owner_unit.code if r.owner_unit else None,
            {"flags": fl, "risk": rcode}, risk=rcode, risk_name=r.name,
            progress=f"{(prog or 0):.0%}")
    for f in by_code["RF7d"]:
        r = risks[f["id"]]
        rec("REC-RISK-UNCOVERED", f["id"], r.owner_unit.code if r.owner_unit else None, {"flags": [f]},
            risk=r.code, risk_name=r.name, level=r.level)
    ev_by_unit = defaultdict(list)
    for f in by_code["RF2"] + by_code["RF7b"]:
        ev_by_unit[f["unit"]].append(f)
    for u, fl in sorted(ev_by_unit.items()):
        rec("REC-EVIDENCE", u, u, {"flags": fl}, unit=units[u].name,
            measures=", ".join(sorted({f["id"] for f in fl})))
    desc = by_code["RF4"] + by_code["RF7c"] + by_code["RF7e"]
    if desc:
        rec("REC-DESCRIPTION", "all", None, {"flags": desc}, measures=", ".join(sorted({f["id"] for f in desc})))
    if by_code["RF5"]:
        rec("REC-INDICATOR", "all", None, {"flags": by_code["RF5"]},
            measures=", ".join(sorted({f["id"] for f in by_code["RF5"]})))
    return sorted(out, key=lambda r: (r["priority"], r["key"]))


# ---------------------------------------------------------------- аналітична довідка
def analytic_note(period: ReportingPeriod) -> dict:
    snaps = snapshot(period)
    flags = compute_flags(period, snaps)
    mon = monitoring(period, snaps)
    risks = risk_state(period, snaps)
    recs = generate_recommendations(period, flags)
    program = Program.objects.first()
    today = SystemSettings.today()
    c, p = mon["counts"], mon["percent"]
    fc = Counter(f["code"] for f in flags)
    stuck = [r for r in risks if r["verdict"] in ("не змінюється", "без заходів") and r["level"] in ("високий", "критичний")]
    lines = [
        f"# Аналітична довідка про стан виконання антикорупційної програми",
        f"**{program.name}**  ",
        f"Звітний період: {period.code} (станом на {period.end.strftime('%d.%m.%Y')}). "
        f"Довідку сформовано автоматично {today.strftime('%d.%m.%Y')} з даних, внесених виконавцями.",
        "",
        "## 1. Загальний стан",
        f"Усього заходів: **{mon['total']}**. Виконано — {c['vykonano']} ({p['vykonano']} %), "
        f"частково виконано — {c['chastkovo']} ({p['chastkovo']} %), у роботі — {c['v_roboti']} ({p['v_roboti']} %), "
        f"не виконано — {c['portal_not_done']} ({p['ne_vykonano']} %), строк не настав — {c['not_due']} ({p['not_due']} %).",
        f"Прострочено за строком програми: {c['overdue']} ({p['overdue']} %). Строк переносили: {c['postponed']} ({p['postponed']} %). "
        f"Із виконаних заходів з конкретною датою вчасно виконано {c['done_on_time']}, із запізненням — {c['done_late']}.",
        f"Інформацію внесли за {c['entered']} заходами ({p['entered']} %), погоджено координатором — {c['approved']} ({p['approved']} %).",
        "",
        "## 2. Стан корупційних ризиків",
        "Оцінюється не кількість закритих заходів, а зміна індикатора стану ризику.",
    ]
    for r in risks:
        prog = "—" if r["progress"] is None else f"{r['progress']:.0%}"
        lines.append(f"- {r['code']} «{r['name']}» (рівень {r['level']}): {_num(r['baseline'])} → {_num(r['current'])} "
                     f"при цілі {_num(r['target'])} {r['unit']}, пройдено {prog} шляху — **{r['verdict']}**; "
                     f"заходів виконано {r['measures_done']} з {r['measures_total']}.")
    lines += ["", "## 3. Проблемні питання (сигнали Risk Flags)",
              f"Виявлено сигналів: {len(flags)}."]
    for code, n in sorted(fc.items()):
        lines.append(f"- {code} — {rules()['flags'][code]['title']}: {n}")
    if stuck:
        lines += ["", "**Критично:** ризики високого/критичного рівня, стан яких не змінюється: "
                  + ", ".join(f"{r['code']} ({r['verdict']})" for r in stuck) + "."]
    lines += ["", "## 4. Запропоновані управлінські рішення",
              "Рекомендації сформовано за явними правилами (rules.yaml). Рішення ухвалює посадова особа; "
              "кожна прийнята рекомендація отримує відповідального і строк."]
    for i, r in enumerate(recs, 1):
        pr = {1: "високий", 2: "середній", 3: "низький"}[r["priority"]]
        lines.append(f"{i}. [{pr} пріоритет] {r['proposed_action']}")
    return {"markdown": "\n".join(lines), "monitoring": mon, "flags_count": dict(fc), "risks": risks,
            "recommendations": recs}
