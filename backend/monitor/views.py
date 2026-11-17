"""REST API AKP Monitor. Документація: /api/docs/ (Swagger), схема: /api/schema/."""
from __future__ import annotations

import csv
import hashlib
import io
from collections import Counter
from datetime import date, timedelta

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import rules as R
from .access import (AUDIT, CONTENT_EDIT, SURVEYS, TECH, VIEW_ALL, can_see_measure, profile, require,
                     scoped_measures)
from .models import (AuditLog, Comment, DeadlineChange, Evidence, Execution, Measure, Profile, Program,
                     Recommendation, ReportingPeriod, Risk, Role, Section, Survey, SystemSettings, Unit)
from .surveys import compare as compare_surveys
from .surveys import group_options, parse_csv

STATUS_NAMES = dict(Execution.Status.choices)


# ---------------------------------------------------------------- допоміжне
def get_period(request) -> ReportingPeriod:
    code = request.query_params.get("period") or request.data.get("period") if hasattr(request, "data") else None
    if code:
        return get_object_or_404(ReportingPeriod, code=code)
    return default_period()


def default_period() -> ReportingPeriod:
    """Поточний звітний період: останній, у якому є внесені дані, або той, чиє вікно відкрите."""
    today = SystemSettings.today()
    open_p = [p for p in ReportingPeriod.objects.all() if p.is_open(today)]
    if open_p:
        return open_p[0]
    with_data = ReportingPeriod.objects.filter(executions__isnull=False).distinct().order_by("-year", "-quarter").first()
    return with_data or ReportingPeriod.objects.filter(end__lt=today).order_by("-end").first() or ReportingPeriod.objects.first()


def unit_dict(u):
    return {"code": u.code, "name": u.name} if u else None


def profile_dict(p: Profile):
    return {"id": p.id, "code": p.code, "role": p.role, "role_name": p.get_role_display(),
            "unit": unit_dict(p.unit), "position": p.position, "username": p.user.username,
            "is_active": p.user.is_active}


def period_dict(p: ReportingPeriod, today=None):
    return {"code": p.code, "year": p.year, "quarter": p.quarter, "start": p.start, "end": p.end,
            "window_start": p.window_start, "window_end": p.window_end, "force_open": p.force_open,
            "is_open": p.is_open(today), "half": p.half}


def execution_dict(e: Execution | None):
    if not e:
        return None
    return {"status": e.status, "status_name": e.get_status_display(), "fact_date": e.fact_date,
            "result_text": e.result_text, "indicator_fact": e.indicator_fact,
            "entered_by": e.entered_by.code if e.entered_by else None, "entered_at": e.entered_at,
            "approval": e.approval, "approval_name": e.get_approval_display(),
            "approved_by": e.approved_by.code if e.approved_by else None, "approved_at": e.approved_at}


def evidence_dict(e: Evidence):
    return {"id": e.id, "code": e.code, "type": e.type, "title": e.title, "doc_date": e.doc_date,
            "link": e.link, "file": e.file.url if e.file else None, "uploaded_at": e.uploaded_at,
            "uploaded_by": e.uploaded_by.code if e.uploaded_by else None, "sha256": e.sha256,
            "period": e.period.code if e.period else None}


def measure_brief(s: R.Snap, period, flags_by_m, overdue_units, today):
    m = s.m
    return {
        "code": m.code, "section": m.section.code, "number": m.number, "content": m.content,
        "risk": m.risk.code if m.risk else None, "risk_level": m.risk.level if m.risk else None,
        "unit": unit_dict(m.responsible_unit), "co_units": [u.code for u in m.co_units.all()],
        "strok_text": m.strok_text, "strok_type": m.strok_type, "strok_date": m.strok_date,
        "current_deadline": m.current_deadline, "postponed": len(s.postponements),
        "indicator": m.indicator, "indicator_unit": m.indicator_unit, "indicator_target": m.indicator_target,
        "required_evidence": m.required_evidence, "evidence_count": len(s.evidence),
        "execution": execution_dict(s.execution), "status": s.status, "status_name": STATUS_NAMES[s.status],
        "portal_state": R.portal_state(s, period.end),
        "flags": flags_by_m.get(m.code, []),
        "nonexecution_risk": R.nonexecution_risk(s, today, overdue_units),
    }


def _flags_index(flags):
    idx = {}
    for f in flags:
        if f["object"] == "zakhid":
            idx.setdefault(f["id"], []).append({"code": f["code"], "title": f["title"],
                                                "explanation": f["explanation"], "severity": f["severity"],
                                                "rule": f["rule"]})
    return idx


def _context(period, p):
    """Знімок і сигнали з урахуванням ролі: виконавець бачить лише свій підрозділ."""
    all_snaps = R.snapshot(period)
    flags = R.compute_flags(period, all_snaps)
    if p.role == Role.VYK:
        snaps = [s for s in all_snaps if s.m.responsible_unit_id == p.unit_id]
        codes = {s.m.code for s in snaps}
        flags = [f for f in flags if (f["object"] == "zakhid" and f["id"] in codes)
                 or (f["object"] == "pidrozdil" and p.unit and f["id"] == p.unit.code)]
    else:
        snaps = all_snaps
    overdue_units = {f["unit"] for f in flags if f["code"] == "RF1"}
    return snaps, flags, overdue_units


# ---------------------------------------------------------------- авторизація
@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    u = authenticate(username=(request.data.get("username") or "").strip().lower(),
                     password=request.data.get("password") or "")
    if not u or not hasattr(u, "profile"):
        return Response({"detail": "Невірний логін або пароль."}, status=400)
    token, _ = Token.objects.get_or_create(user=u)
    AuditLog.write(u.profile, "вхід у систему", "korystuvach", u.profile.code)
    return Response({"token": token.key, "profile": profile_dict(u.profile)})


@api_view(["GET"])
@permission_classes([AllowAny])
def demo_users(request):
    """Список демо-облікових записів для сторінки входу (лише синтетичні ролі, без імен)."""
    return Response([profile_dict(p) for p in Profile.objects.select_related("unit", "user").order_by("code")
                     if p.user.is_active])


@api_view(["GET"])
def me(request):
    p = profile(request)
    today = SystemSettings.today()
    per = default_period()
    return Response({"profile": profile_dict(p), "today": today, "current_period": period_dict(per, today)})


# ---------------------------------------------------------------- програма і довідники
@api_view(["GET"])
def program(request):
    profile(request)
    pr = Program.objects.select_related("organ", "coordinator_unit").first()
    secs = []
    for s in Section.objects.filter(program=pr):
        secs.append({"code": s.code, "number": s.number, "portal_name": s.portal_name,
                     "measures": s.measures.count()})
    return Response({"code": pr.code, "name": pr.name, "organ": pr.organ.name, "period_start": pr.period_start,
                     "period_end": pr.period_end, "approved": pr.approved, "nazk_status": pr.nazk_status,
                     "restricted_info": pr.restricted_info, "coordinator_unit": unit_dict(pr.coordinator_unit),
                     "goals": pr.goals, "note": pr.note, "sections": secs,
                     "risks": Risk.objects.count(), "measures": Measure.objects.count()})


@api_view(["PATCH"])
def program_update(request):
    p = require(request, CONTENT_EDIT)
    pr = Program.objects.first()
    if "restricted_info" in request.data:
        new = bool(request.data["restricted_info"])
        AuditLog.write(p, "змінено ознаку обмеженого доступу програми", "prohrama", pr.code,
                       "restricted_info", pr.restricted_info, new)
        pr.restricted_info = new
        pr.save()
    return Response({"restricted_info": pr.restricted_info})


@api_view(["GET"])
def units(request):
    profile(request)
    return Response([{"code": u.code, "name": u.name, "type": u.type, "note": u.note}
                     for u in Unit.objects.all()])


@api_view(["GET"])
def periods(request):
    profile(request)
    today = SystemSettings.today()
    return Response([period_dict(p, today) for p in ReportingPeriod.objects.all()])


@api_view(["PATCH"])
def period_update(request, code):
    p = require(request, TECH | CONTENT_EDIT, "Звітні вікна налаштовує технічний адміністратор або уповноважений.")
    per = get_object_or_404(ReportingPeriod, code=code)
    for f in ("force_open", "window_start", "window_end"):
        if f in request.data:
            old = getattr(per, f)
            new = request.data[f]
            if f != "force_open":
                new = date.fromisoformat(new)
            setattr(per, f, new)
            AuditLog.write(p, "змінено звітне вікно", "period", per.code, f, old, new)
    per.save()
    return Response(period_dict(per))


@api_view(["GET", "PATCH"])
def system_settings(request):
    s = SystemSettings.get()
    if request.method == "PATCH":
        p = require(request, TECH, "Налаштування змінює технічний адміністратор.")
        for f in ("today_override", "window_days", "reminder_days", "min_survey_group"):
            if f in request.data:
                v = request.data[f]
                if f == "today_override":
                    v = date.fromisoformat(v) if v else None
                else:
                    v = int(v)
                AuditLog.write(p, "змінено налаштування", "nalashtuvannia", "system", f, getattr(s, f), v)
                setattr(s, f, v)
        s.save()
    else:
        profile(request)
    return Response({"today_override": s.today_override, "today": SystemSettings.today(),
                     "window_days": s.window_days, "reminder_days": s.reminder_days,
                     "min_survey_group": s.min_survey_group})


@api_view(["GET"])
def rules_catalog(request):
    profile(request)
    cfg = R.rules()
    return Response({"flags": R.flag_catalog(), "nonexecution_risk": cfg["nonexecution_risk"],
                     "recommendations": cfg["recommendations"]})


# ---------------------------------------------------------------- заходи
@api_view(["GET", "POST"])
def measures(request):
    p = profile(request)
    if request.method == "POST":
        return _measure_create(request, p)
    period = get_period(request)
    today = SystemSettings.today()
    snaps, flags, overdue_units = _context(period, p)
    idx = _flags_index(flags)
    items = [measure_brief(s, period, idx, overdue_units, today) for s in snaps]
    q = request.query_params
    if q.get("section"):
        items = [i for i in items if i["section"] == q["section"]]
    if q.get("unit"):
        items = [i for i in items if i["unit"]["code"] == q["unit"]]
    if q.get("status"):
        items = [i for i in items if i["status"] == q["status"] or i["portal_state"] == q["status"]]
    if q.get("flag"):
        items = [i for i in items if any(f["code"] == q["flag"] for f in i["flags"])]
    if q.get("risk"):
        items = [i for i in items if i["risk"] == q["risk"]]
    if q.get("q"):
        s = q["q"].lower()
        items = [i for i in items if s in i["content"].lower() or s in i["code"].lower()]
    return Response({"period": period_dict(period, today), "items": items})


def _measure_create(request, p):
    require(request, CONTENT_EDIT, "Планувати заходи може лише уповноважений.")
    d = request.data
    pr = Program.objects.first()
    errors = {}
    sec = Section.objects.filter(program=pr, code=d.get("section")).first()
    unit = Unit.objects.filter(code=d.get("unit")).first()
    risk = Risk.objects.filter(code=d.get("risk")).first() if d.get("risk") else None
    if not sec:
        errors["section"] = "Оберіть розділ програми."
    if not unit:
        errors["unit"] = "Оберіть відповідальний підрозділ."
    if not (d.get("content") or "").strip():
        errors["content"] = "Вкажіть зміст заходу."
    if not (d.get("strok_text") or "").strip():
        errors["strok_text"] = "Вкажіть строк, як у програмі."
    if d.get("strok_type", "data") == "data" and not d.get("strok_date"):
        errors["strok_date"] = "Для строку «до дати» вкажіть кінцеву дату."
    if not (d.get("indicator") or "").strip():
        errors["indicator"] = "Вкажіть індикатор виконання."
    if errors:
        raise ValidationError(errors)
    if sec.code == "R2" and not risk:
        raise ValidationError({"risk": "Захід розділу 2 має бути повʼязаний з корупційним ризиком."})
    n = Measure.objects.count() + 1
    code = f"Z-{n:02d}"
    while Measure.objects.filter(code=code).exists():
        n += 1
        code = f"Z-{n:02d}"
    m = Measure.objects.create(
        code=code, program=pr, section=sec, number=sec.measures.count() + 1, content=d.get("content", ""),
        risk=risk, responsible_unit=unit, strok_text=d.get("strok_text", ""), strok_type=d.get("strok_type", "data"),
        strok_date=date.fromisoformat(d["strok_date"]) if d.get("strok_date") else None,
        indicator=d.get("indicator", ""), indicator_unit=d.get("indicator_unit", ""),
        indicator_target=float(d["indicator_target"]) if d.get("indicator_target") not in (None, "") else None,
        required_evidence=d.get("required_evidence", ""), resources=d.get("resources", ""))
    AuditLog.write(p, "створено захід", "zakhid", m.code)
    return Response({"code": m.code}, status=201)


@api_view(["GET", "PATCH"])
def measure_detail(request, code):
    p = profile(request)
    m = get_object_or_404(Measure.objects.select_related("section", "risk", "responsible_unit"), code=code)
    if not can_see_measure(p, m):
        raise PermissionDenied("Цей захід належить іншому підрозділу.")
    if request.method == "PATCH":
        require(request, CONTENT_EDIT, "Змінювати план заходу може лише уповноважений.")
        editable = ["content", "strok_text", "indicator", "indicator_unit", "required_evidence", "resources"]
        for f in editable:
            if f in request.data and request.data[f] != getattr(m, f):
                AuditLog.write(p, "змінено захід", "zakhid", m.code, f, getattr(m, f), request.data[f])
                setattr(m, f, request.data[f])
        if "indicator_target" in request.data:
            v = request.data["indicator_target"]
            v = float(v) if v not in (None, "") else None
            AuditLog.write(p, "змінено захід", "zakhid", m.code, "indicator_target", m.indicator_target, v)
            m.indicator_target = v
        m.save()
    period = get_period(request)
    today = SystemSettings.today()
    snaps = R.snapshot(period, Measure.objects.filter(pk=m.pk))
    all_flags = R.compute_flags(period)
    overdue_units = {f["unit"] for f in all_flags if f["code"] == "RF1"}
    idx = _flags_index(all_flags)
    s = snaps[0]
    data = measure_brief(s, period, idx, overdue_units, today)
    data.update({
        "risk_detail": None,
        "section_name": m.section.portal_name,
        "evidence": [evidence_dict(e) for e in m.evidence.all()],
        "comments": [{"id": c.id, "author": c.author.code, "author_role": c.author.get_role_display(),
                      "text": c.text, "is_remark": c.is_remark, "created_at": c.created_at,
                      "period": c.period.code if c.period else None} for c in m.comments.select_related("author")],
        "deadline_changes": [{"decision_date": d.decision_date, "old_date": d.old_date, "new_date": d.new_date,
                              "reason": d.reason, "approved_by": d.approved_by.code if d.approved_by else None}
                             for d in m.deadline_changes.all()],
        "history": [{"executions": [{"period": e.period.code, **execution_dict(e)}
                                    for e in m.executions.select_related("period", "entered_by", "approved_by")]}],
        "audit": [_audit_dict(a) for a in AuditLog.objects.filter(obj_id__in=[m.code] + [e.code for e in m.evidence.all()])
                  .select_related("actor").order_by("-id")[:100]],
        "can_edit_execution": _can_edit_execution(p, m, period),
        "period": period_dict(period, today),
    })
    if m.risk:
        r = m.risk
        data["risk_detail"] = {"code": r.code, "name": r.name, "level": r.level, "indicator": r.indicator,
                               "unit": r.indicator_unit, "baseline": r.baseline, "target": r.target,
                               "current": r.value_on(period.end), "progress": r.progress_on(period.end),
                               "history": [{"date": x.date, "value": x.value} for x in r.measurements.all()]}
    return Response(data)


def _can_edit_execution(p, m, period):
    if p.role == Role.KOORD:
        return {"allowed": True, "reason": "уповноважений може вносити зміни в будь-який час"}
    if p.role != Role.VYK or m.responsible_unit_id != p.unit_id:
        return {"allowed": False, "reason": "лише перегляд"}
    if not period.is_open():
        return {"allowed": False,
                "reason": f"вікно внесення за {period.code} — {period.window_start:%d.%m}–{period.window_end:%d.%m.%Y}"}
    ex = Execution.objects.filter(measure=m, period=period).first()
    if ex and ex.approval == "approved":
        return {"allowed": False, "reason": "інформацію вже погоджено координатором"}
    return {"allowed": True, "reason": f"вікно відкрите до {period.window_end:%d.%m.%Y}"}


@api_view(["POST"])
def execution_save(request, code):
    """Внесення інформації про виконання за один крок. Повертає попередню перевірку:
    які сигнали спрацюють, якщо подати саме так (до погодження координатором)."""
    p = profile(request)
    m = get_object_or_404(Measure, code=code)
    if not can_see_measure(p, m):
        raise PermissionDenied("Цей захід належить іншому підрозділу.")
    period = get_period(request)
    perm = _can_edit_execution(p, m, period)
    if not perm["allowed"]:
        raise PermissionDenied(f"Внесення недоступне: {perm['reason']}.")
    d = request.data
    with transaction.atomic():
        ex, created = Execution.objects.get_or_create(measure=m, period=period)
        changes = {}
        if "status" in d:
            if d["status"] not in STATUS_NAMES:
                raise ValidationError({"status": "Невідомий статус."})
            changes["status"] = d["status"]
        if "fact_date" in d:
            changes["fact_date"] = date.fromisoformat(d["fact_date"]) if d["fact_date"] else None
        if "result_text" in d:
            changes["result_text"] = (d["result_text"] or "").strip()
        if "indicator_fact" in d:
            changes["indicator_fact"] = float(d["indicator_fact"]) if d["indicator_fact"] not in (None, "") else None
        for f, v in changes.items():
            old = getattr(ex, f)
            if old != v:
                AuditLog.write(p, "внесено інформацію про виконання", "vykonannia", m.code, f,
                               STATUS_NAMES.get(old, old) if f == "status" else old,
                               STATUS_NAMES.get(v, v) if f == "status" else v)
                setattr(ex, f, v)
        ex.entered_by = p
        ex.entered_at = timezone.now()
        if d.get("submit"):
            ex.approval = "submitted"
            AuditLog.write(p, "подано на погодження", "vykonannia", m.code)
        ex.save()
    snaps = R.snapshot(period, Measure.objects.filter(pk=m.pk))
    precheck = [f for f in R.compute_flags(period, snaps) if f["object"] == "zakhid"]
    hints = []
    st = ex.status
    if st in ("ne_vykonano",) or (R.portal_state(snaps[0], period.end) == R.PORTAL_NOT_DONE and not ex.result_text):
        hints.append("Для невиконаного заходу обовʼязково поясніть причини.")
    if st in ("vykonano", "chastkovo") and not snaps[0].evidence:
        hints.append(f"Додайте підтвердні матеріали: {m.required_evidence or 'документ, що підтверджує виконання'}.")
    if st in ("vykonano", "chastkovo") and m.indicator_target is not None and ex.indicator_fact is None:
        hints.append(f"Вкажіть фактичне значення індикатора «{m.indicator}» (ціль {R._num(m.indicator_target)} {m.indicator_unit}).")
    return Response({"execution": execution_dict(ex), "precheck": precheck, "hints": hints})


@api_view(["POST"])
def execution_approve(request, code):
    p = require(request, CONTENT_EDIT, "Погоджує інформацію координатор програми (уповноважений).")
    m = get_object_or_404(Measure, code=code)
    period = get_period(request)
    ex = get_object_or_404(Execution, measure=m, period=period)
    decision = request.data.get("decision")
    comment = (request.data.get("comment") or "").strip()
    if decision == "approve":
        ex.approval, ex.approved_by, ex.approved_at = "approved", p, timezone.now()
        AuditLog.write(p, "погоджено координатором", "vykonannia", m.code)
    elif decision == "return":
        if not comment:
            raise ValidationError({"comment": "Вкажіть зауваження для виконавця."})
        ex.approval = "returned"
        AuditLog.write(p, "повернуто на доопрацювання", "vykonannia", m.code, "comment", "", comment)
    else:
        raise ValidationError({"decision": "approve або return"})
    ex.save()
    if comment:
        Comment.objects.create(measure=m, period=period, author=p, text=comment, is_remark=True)
    return Response(execution_dict(ex))


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def evidence_add(request, code):
    p = profile(request)
    m = get_object_or_404(Measure, code=code)
    period = get_period(request)
    perm = _can_edit_execution(p, m, period)
    if not perm["allowed"]:
        raise PermissionDenied(f"Додавання недоступне: {perm['reason']}.")
    d = request.data
    if not d.get("title") or not d.get("doc_date"):
        raise ValidationError({"title": "Вкажіть назву і дату документа."})
    f = request.FILES.get("file")
    h = hashlib.sha256()
    if f:
        for chunk in f.chunks():
            h.update(chunk)
        f.seek(0)
    n = Evidence.objects.count() + 1
    code_e = f"E-{n:03d}"
    while Evidence.objects.filter(code=code_e).exists():
        n += 1
        code_e = f"E-{n:03d}"
    if not f:
        h.update(f"{code_e}|{m.code}|{d['title']}|{d['doc_date']}".encode("utf-8"))
    e = Evidence(code=code_e, measure=m, period=period, type=d.get("type") or "документ", title=d["title"],
                 doc_date=date.fromisoformat(d["doc_date"]), link=d.get("link") or "",
                 uploaded_at=timezone.now(), uploaded_by=p, sha256=h.hexdigest())
    if f:
        e.file = f
    e.save()
    AuditLog.write(p, "завантажено підтвердний матеріал", "pidtverdzhennia", e.code, "sha256", "", e.sha256)
    return Response(evidence_dict(e), status=201)


@api_view(["GET"])
def evidence_verify(request, code):
    require(request, VIEW_ALL)
    e = get_object_or_404(Evidence, code=code)
    return Response({"code": e.code, "sha256": e.sha256, "file_ok": e.verify()})


@api_view(["POST"])
def comment_add(request, code):
    p = profile(request)
    m = get_object_or_404(Measure, code=code)
    if not can_see_measure(p, m) or p.role in (Role.KER, Role.ANAL, Role.ADMIN):
        raise PermissionDenied("Коментувати можуть виконавець заходу та уповноважений.")
    text = (request.data.get("text") or "").strip()
    if not text:
        raise ValidationError({"text": "Порожній коментар."})
    c = Comment.objects.create(measure=m, period=get_period(request), author=p, text=text,
                               is_remark=p.role == Role.KOORD)
    AuditLog.write(p, "додано коментар", "zakhid", m.code, "comment", "", text)
    return Response({"id": c.id}, status=201)


@api_view(["POST"])
def deadline_change(request, code):
    p = require(request, CONTENT_EDIT, "Перенесення строку погоджує уповноважений.")
    m = get_object_or_404(Measure, code=code)
    if m.strok_type != "data":
        raise ValidationError({"new_date": "Перенести можна лише строк, визначений датою."})
    try:
        new = date.fromisoformat(request.data.get("new_date") or "")
    except ValueError:
        raise ValidationError({"new_date": "Вкажіть новий строк."})
    reason = (request.data.get("reason") or "").strip()
    if not reason:
        raise ValidationError({"reason": "Вкажіть причину перенесення."})
    old = m.current_deadline
    DeadlineChange.objects.create(measure=m, decision_date=SystemSettings.today(), old_date=old, new_date=new,
                                  reason=reason, approved_by=p)
    AuditLog.write(p, "змінено внутрішній строк", "zakhid", m.code, "strok_aktualnyi", old, new)
    return Response({"current_deadline": new})


# ---------------------------------------------------------------- панелі
@api_view(["GET"])
def dashboard(request):
    p = profile(request)
    period = get_period(request)
    today = SystemSettings.today()
    s = SystemSettings.get()
    snaps, flags, overdue_units = _context(period, p)
    idx = _flags_index(flags)
    briefs = [measure_brief(x, period, idx, overdue_units, today) for x in snaps]
    upcoming = sorted([b for b in briefs if b["strok_type"] == "data" and b["status"] != "vykonano"
                       and b["current_deadline"] and today <= b["current_deadline"] <= today + timedelta(days=120)],
                      key=lambda b: b["current_deadline"])
    critical = sorted([b for b in briefs if b["nonexecution_risk"]["level"] == "високий"
                       or any(f["severity"] == "high" for f in b["flags"])],
                      key=lambda b: (-b["nonexecution_risk"]["score"], b["code"]))
    flag_counts = Counter(f["code"] for f in flags)
    risks = R.risk_state(period, snaps) if p.role != Role.VYK else \
        [r for r in R.risk_state(period, snaps) if r["measures_total"]]
    units_map = R.breakdown(period, snaps, "unit")
    for u in units_map:
        u_snaps = [x for x in snaps if x.m.responsible_unit.code == u["code"]]
        levels = Counter(R.nonexecution_risk(x, today, overdue_units)["level"] for x in u_snaps)
        u["nonexecution"] = dict(levels)
        u["flags"] = sum(1 for f in flags if f.get("unit") == u["code"])
    return Response({
        "period": period_dict(period, today), "today": today,
        "monitoring": R.monitoring(period, snaps),
        "by_section": R.breakdown(period, snaps, "section"),
        "by_unit": units_map,
        "flags": {"total": len(flags), "by_code": dict(flag_counts),
                  "catalog": {c["code"]: c["title"] for c in R.flag_catalog()}},
        "risks": risks,
        "upcoming": upcoming[:15],
        "critical": critical[:15],
        "reminders": _reminders(p, period, briefs, today, s.reminder_days),
    })


def _reminders(p, period, briefs, today, days):
    out = []
    if p.role in (Role.VYK, Role.KOORD):
        if period.is_open(today):
            out.append({"level": "info", "text": f"Вікно внесення за {period.code} відкрите до "
                                                 f"{period.window_end:%d.%m.%Y}."})
        else:
            nxt = ReportingPeriod.objects.filter(window_start__gt=today).order_by("window_start").first()
            if nxt:
                out.append({"level": "info", "text": f"Наступне вікно внесення ({nxt.code}): "
                                                     f"{nxt.window_start:%d.%m}–{nxt.window_end:%d.%m.%Y}."})
    for b in briefs:
        dl = b["current_deadline"]
        if b["strok_type"] != "data" or b["status"] == "vykonano" or not dl:
            continue
        left = (dl - today).days
        if left < 0:
            out.append({"level": "danger", "measure": b["code"],
                        "text": f"{b['code']}: строк минув {dl:%d.%m.%Y} ({-left} дн. тому)."})
        elif left <= days:
            out.append({"level": "warning", "measure": b["code"],
                        "text": f"{b['code']}: до строку {left} дн. ({dl:%d.%m.%Y})."})
    if p.role == Role.VYK:
        for b in briefs:
            ex = b["execution"]
            if ex and ex["approval"] == "returned":
                out.append({"level": "danger", "measure": b["code"],
                            "text": f"{b['code']}: координатор повернув інформацію на доопрацювання."})
            elif not ex or not ex["entered_at"]:
                out.append({"level": "warning", "measure": b["code"],
                            "text": f"{b['code']}: інформацію за {period.code} ще не внесено."})
    if p.role == Role.KOORD:
        n = sum(1 for b in briefs if b["execution"] and b["execution"]["approval"] == "submitted")
        if n:
            out.append({"level": "warning", "text": f"Очікують погодження: {n} заходів."})
    return out


@api_view(["GET"])
def flags(request):
    p = profile(request)
    period = get_period(request)
    _, fl, _ = _context(period, p)
    return Response({"period": period.code, "items": fl, "catalog": R.flag_catalog()})


@api_view(["GET"])
def risks(request):
    p = profile(request)
    period = get_period(request)
    snaps, _, _ = _context(period, p)
    return Response(R.risk_state(period, snaps))


@api_view(["GET"])
def calendar(request):
    p = profile(request)
    period = get_period(request)
    today = SystemSettings.today()
    items = []
    for m in scoped_measures(p).select_related("responsible_unit"):
        if m.strok_type == "data" and m.strok_date:
            ex = m.executions.filter(period=period).first()
            items.append({"date": m.current_deadline, "program_date": m.strok_date, "measure": m.code,
                          "content": m.content, "unit": m.responsible_unit.code,
                          "status": ex.status if ex else "ne_rozpochato"})
    for per in ReportingPeriod.objects.all():
        items.append({"date": per.window_start, "window_end": per.window_end, "type": "window",
                      "content": f"Вікно внесення інформації за {per.code}"})
    for half_end in (date(today.year, 6, 30), date(today.year, 12, 31)):
        items.append({"date": half_end, "type": "report", "content": "Кінець півріччя: звіт для Порталу НАЗК"})
    return Response(sorted(items, key=lambda i: i["date"]))


# ---------------------------------------------------------------- рекомендації
@api_view(["GET"])
def recommendations(request):
    p = require(request, VIEW_ALL)
    period = get_period(request)
    gen = R.generate_recommendations(period, R.compute_flags(period))
    units = {u.code: u for u in Unit.objects.all()}
    for g in gen:
        Recommendation.objects.get_or_create(key=g["key"], defaults={
            "rule": g["rule"], "priority": g["priority"], "title": g["title"], "basis": g["basis"],
            "proposed_action": g["proposed_action"], "target_unit": units.get(g["target_unit"])})
    active_keys = {g["key"] for g in gen}
    items = []
    for r in Recommendation.objects.filter(key__startswith=period.code + ":").select_related(
            "target_unit", "responsible_unit", "decided_by"):
        items.append({"id": r.id, "key": r.key, "rule": r.rule, "priority": r.priority, "title": r.title,
                      "basis": r.basis, "proposed_action": r.proposed_action, "target_unit": unit_dict(r.target_unit),
                      "state": r.state, "state_name": r.get_state_display(),
                      "responsible_unit": unit_dict(r.responsible_unit), "due_date": r.due_date,
                      "decided_by": r.decided_by.code if r.decided_by else None, "decided_at": r.decided_at,
                      "decision_comment": r.decision_comment, "still_relevant": r.key in active_keys})
    return Response({"period": period.code, "items": items,
                     "can_decide": p.role == Role.KOORD})


@api_view(["POST"])
def recommendation_decide(request, pk):
    p = require(request, CONTENT_EDIT, "Рішення щодо рекомендацій ухвалює уповноважений.")
    r = get_object_or_404(Recommendation, pk=pk)
    state = request.data.get("state")
    if state not in dict(Recommendation.State.choices):
        raise ValidationError({"state": "Невідомий стан."})
    if state == "accepted":
        unit = Unit.objects.filter(code=request.data.get("responsible_unit")).first()
        due = request.data.get("due_date")
        if not unit or not due:
            raise ValidationError({"detail": "Прийнята рекомендація має мати відповідального і строк."})
        r.responsible_unit, r.due_date = unit, date.fromisoformat(due)
    if state == "rejected" and not (request.data.get("comment") or "").strip():
        raise ValidationError({"comment": "Вкажіть причину відхилення."})
    AuditLog.write(p, "рішення щодо рекомендації", "rekomendatsiia", r.key, "state", r.state, state)
    r.state, r.decided_by, r.decided_at = state, p, timezone.now()
    r.decision_comment = request.data.get("comment", r.decision_comment)
    r.save()
    return Response({"ok": True})


# ---------------------------------------------------------------- звіти й експорт
def _xlsx_response(filename, sheets):
    wb = Workbook()
    wb.remove(wb.active)
    head_fill = PatternFill("solid", fgColor="0B2A5B")
    for title, header, data in sheets:
        ws = wb.create_sheet(title[:31])
        ws.append(header)
        for c in ws[1]:
            c.font = Font(name="Times New Roman", size=12, bold=True, color="FFFFFF")
            c.fill = head_fill
            c.alignment = Alignment(wrap_text=True, vertical="top")
        for row in data:
            ws.append(row)
        for col in ws.columns:
            w = max(len(str(c.value or "")) for c in col[:50])
            ws.column_dimensions[col[0].column_letter].width = min(max(10, w * 0.9), 60)
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(wrap_text=True, vertical="top")
                c.font = Font(name="Times New Roman", size=12)
        ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    resp = HttpResponse(buf.getvalue(),
                        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


def _docx_response(filename, content: bytes):
    resp = HttpResponse(content, content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


def _csv_response(filename, header, data):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(data)
    resp = HttpResponse("﻿" + buf.getvalue(), content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


@api_view(["GET"])
def report_portal(request):
    """Звіт за півріччя у структурі Порталу доброчесності НАЗК."""
    require(request, VIEW_ALL)
    year = int(request.query_params.get("year", 2026))
    half = int(request.query_params.get("half", 1))
    pr = Program.objects.first()
    rows = R.portal_report(pr, year, half)
    fmt = request.query_params.get("format", "json")
    keys = [k for k, _ in R.REPORT_COLUMNS]
    names = [n for _, n in R.REPORT_COLUMNS]
    fname = f"zvit_portal_{year}_h{half}"
    if fmt == "docx":
        from .reports_docx import portal_docx
        return _docx_response(fname + ".docx", portal_docx(year, half))
    if fmt == "csv":
        return _csv_response(fname + ".csv", keys, [[r[k] for k in keys] for r in rows])
    if fmt == "xlsx":
        sheets = []
        for sec in Section.objects.filter(program=pr):
            data = [[r[k] for k in keys] for r in rows if r["rozdil_portal"] == sec.portal_name]
            sheets.append((f"Розділ {sec.number}", names, data))
        return _xlsx_response(fname + ".xlsx", sheets)
    return Response({"program": pr.name, "organ": pr.organ.name, "restricted_info": pr.restricted_info,
                     "year": year, "half": half, "columns": R.REPORT_COLUMNS, "rows": rows,
                     "sections": [s.portal_name for s in Section.objects.filter(program=pr)]})


@api_view(["GET"])
def report_internal(request):
    """Внутрішній звіт: усі заходи зі статусами, сигналами і ризиком невиконання."""
    p = profile(request)
    period = get_period(request)
    today = SystemSettings.today()
    snaps, fl, overdue_units = _context(period, p)
    idx = _flags_index(fl)
    briefs = [measure_brief(s, period, idx, overdue_units, today) for s in snaps]
    header = ["Код", "Розділ", "№", "Зміст заходу", "Підрозділ", "Строк", "Актуальний строк", "Перенесень",
              "Статус", "Стан для Порталу", "Фактична дата", "Індикатор", "Ціль", "Факт", "Підтверджень",
              "Погодження", "Сигнали", "Ризик невиконання", "Корупційний ризик"]
    data = [[b["code"], b["section"], b["number"], b["content"], b["unit"]["name"], b["strok_text"],
             b["current_deadline"].isoformat() if b["current_deadline"] else "", b["postponed"], b["status_name"],
             b["portal_state"], (b["execution"] or {}).get("fact_date") or "", b["indicator"], b["indicator_target"],
             (b["execution"] or {}).get("indicator_fact"), b["evidence_count"],
             (b["execution"] or {}).get("approval_name", ""), ", ".join(f["code"] for f in b["flags"]),
             b["nonexecution_risk"]["level"], b["risk"] or ""] for b in briefs]
    for row in data:
        if hasattr(row[10], "isoformat"):
            row[10] = row[10].isoformat()
    fmt = request.query_params.get("format", "xlsx")
    if fmt == "csv":
        return _csv_response(f"vnutrishnii_zvit_{period.code}.csv", header, data)
    flag_rows = [[f["code"], f["title"], f["object"], f["id"], f.get("unit") or "", f["explanation"], f["rule"]]
                 for f in fl]
    return _xlsx_response(f"vnutrishnii_zvit_{period.code}.xlsx", [
        ("Заходи", header, data),
        ("Сигнали", ["Код", "Сигнал", "Обʼєкт", "ID", "Підрозділ", "Пояснення", "Правило"], flag_rows)])


@api_view(["GET"])
def report_note(request):
    require(request, VIEW_ALL)
    period = get_period(request)
    if request.query_params.get("format") == "docx":
        from .reports_docx import note_docx
        return _docx_response(f"analitychna_dovidka_{period.code}.docx", note_docx(period))
    note = R.analytic_note(period)
    if request.query_params.get("format") == "md":
        resp = HttpResponse(note["markdown"], content_type="text/markdown; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="analitychna_dovidka_{period.code}.md"'
        return resp
    return Response(note)


@api_view(["GET"])
def selfcheck(request):
    """Самоперевірка на наборі організаторів: сигнали vs ключ, звіт vs еталон."""
    require(request, VIEW_ALL)
    from .selfcheck import run_selfcheck
    return Response(run_selfcheck())


# ---------------------------------------------------------------- журнал дій
def _audit_dict(a: AuditLog):
    return {"id": a.id, "ts": a.ts, "actor": a.actor.code if a.actor else None,
            "actor_role": a.actor.get_role_display() if a.actor else None, "action": a.action,
            "obj_type": a.obj_type, "obj_id": a.obj_id, "field": a.field, "old": a.old_value, "new": a.new_value,
            "hash": a.hash, "prev_hash": a.prev_hash}


@api_view(["GET"])
def audit(request):
    require(request, AUDIT, "Журнал дій доступний уповноваженому, техадміністратору, керівнику та аналітику.")
    qs = AuditLog.objects.select_related("actor").order_by("-id")
    q = request.query_params
    if q.get("obj_id"):
        qs = qs.filter(obj_id=q["obj_id"])
    if q.get("actor"):
        qs = qs.filter(actor__code=q["actor"])
    if q.get("action"):
        qs = qs.filter(action__icontains=q["action"])
    limit = min(int(q.get("limit", 200)), 2000)
    return Response({"total": qs.count(), "items": [_audit_dict(a) for a in qs[:limit]]})


@api_view(["GET"])
def audit_verify(request):
    require(request, AUDIT)
    return Response(AuditLog.verify_chain())


@api_view(["GET"])
def audit_export(request):
    require(request, AUDIT)
    header = ["id", "chas", "korystuvach", "diia", "obiekt", "obiekt_id", "pole", "stare", "nove", "prev_hash", "hash"]
    data = [[a.id, a.ts.isoformat(), a.actor.code if a.actor else "", a.action, a.obj_type, a.obj_id, a.field,
             a.old_value, a.new_value, a.prev_hash, a.hash] for a in AuditLog.objects.select_related("actor")]
    return _csv_response("zhurnal_dii.csv", header, data)


# ---------------------------------------------------------------- опитування (лише уповноважений)
@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def surveys(request):
    p = require(request, SURVEYS, "Опитування доступні лише уповноваженому.")
    if request.method == "POST":
        f = request.FILES.get("file")
        if not f:
            raise ValidationError({"file": "Завантажте CSV, експортований з Google Форми."})
        try:
            parsed = parse_csv(f.read())
        except Exception as e:  # noqa: BLE001
            raise ValidationError({"file": f"Не вдалося прочитати CSV: {e}"})
        s = Survey.objects.create(title=request.data.get("title") or f.name, uploaded_by=p,
                                  questions=parsed["questions"], answers=parsed["answers"],
                                  dropped_columns=parsed["dropped"])
        AuditLog.write(p, "завантажено результати опитування", "opytuvannia", s.id, "vidpovidei", "", s.n)
        return Response({"id": s.id, "n": s.n, "dropped_columns": s.dropped_columns}, status=201)
    return Response([{"id": s.id, "title": s.title, "uploaded_at": s.uploaded_at, "n": s.n,
                      "questions": len(s.questions), "dropped_columns": s.dropped_columns}
                     for s in Survey.objects.order_by("uploaded_at")])


@api_view(["DELETE"])
def survey_delete(request, pk):
    p = require(request, SURVEYS)
    s = get_object_or_404(Survey, pk=pk)
    AuditLog.write(p, "видалено результати опитування", "opytuvannia", s.id, "title", s.title, "")
    s.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def survey_compare(request):
    require(request, SURVEYS, "Опитування доступні лише уповноваженому.")
    a = get_object_or_404(Survey, pk=request.query_params.get("a"))
    b = get_object_or_404(Survey, pk=request.query_params.get("b"))
    da = {"questions": a.questions, "answers": a.answers}
    db = {"questions": b.questions, "answers": b.answers}
    res = compare_surveys(da, db, SystemSettings.get().min_survey_group,
                         request.query_params.get("fq"), request.query_params.get("fv"))
    res.update({"a": {"id": a.id, "title": a.title}, "b": {"id": b.id, "title": b.title},
                "filters": group_options(da, db)})
    return Response(res)


# ---------------------------------------------------------------- технічне адміністрування
@api_view(["GET", "POST"])
def users(request):
    p = require(request, TECH, "Облікові записи веде технічний адміністратор.")
    if request.method == "POST":
        d = request.data
        code = (d.get("code") or "").strip().upper()
        if not code or Profile.objects.filter(code=code).exists():
            raise ValidationError({"code": "Код порожній або вже існує."})
        if d.get("role") not in dict(Role.choices):
            raise ValidationError({"role": "Невідома роль."})
        unit = Unit.objects.filter(code=d.get("unit")).first()
        if d["role"] == Role.VYK and not unit:
            raise ValidationError({"unit": "Виконавцю потрібен підрозділ."})
        u = User.objects.create_user(username=code.lower(), password=d.get("password") or "demo")
        Token.objects.create(user=u)
        np = Profile.objects.create(user=u, code=code, role=d["role"], unit=unit, position=d.get("position", ""))
        AuditLog.write(p, "створено обліковий запис", "korystuvach", code, "role", "", d["role"])
        return Response(profile_dict(np), status=201)
    return Response([profile_dict(x) for x in Profile.objects.select_related("unit", "user").order_by("code")])


@api_view(["PATCH"])
def user_update(request, code):
    p = require(request, TECH, "Облікові записи веде технічний адміністратор.")
    x = get_object_or_404(Profile, code=code)
    d = request.data
    if "role" in d and d["role"] != x.role:
        AuditLog.write(p, "змінено роль", "korystuvach", x.code, "role", x.role, d["role"])
        x.role = d["role"]
    if "unit" in d:
        unit = Unit.objects.filter(code=d["unit"]).first()
        AuditLog.write(p, "змінено підрозділ", "korystuvach", x.code, "unit", x.unit.code if x.unit else "",
                       unit.code if unit else "")
        x.unit = unit
    if "position" in d:
        x.position = d["position"]
    x.save()
    if "is_active" in d:
        x.user.is_active = bool(d["is_active"])
        x.user.save()
        AuditLog.write(p, "змінено активність", "korystuvach", x.code, "is_active", "", x.user.is_active)
    if d.get("password"):
        x.user.set_password(d["password"])
        x.user.save()
        Token.objects.filter(user=x.user).delete()
        Token.objects.create(user=x.user)
        AuditLog.write(p, "скинуто пароль", "korystuvach", x.code)
    return Response(profile_dict(x))


@api_view(["GET"])
def system_health(request):
    require(request, TECH | {Role.KOORD}, "Стан системи бачать техадміністратор і уповноважений.")
    from django.db import connection
    ev_files = Evidence.objects.exclude(file="")
    bad = [e.code for e in ev_files if e.verify() is False]
    return Response({
        "db_engine": connection.vendor,
        "audit_chain": AuditLog.verify_chain(),
        "counts": {"measures": Measure.objects.count(), "risks": Risk.objects.count(),
                   "executions": Execution.objects.count(), "evidence": Evidence.objects.count(),
                   "evidence_files": ev_files.count(), "audit": AuditLog.objects.count(),
                   "users": Profile.objects.count(), "surveys": Survey.objects.count()},
        "evidence_integrity_failed": bad,
        "today": SystemSettings.today(),
        "external_services": "не використовуються",
    })
