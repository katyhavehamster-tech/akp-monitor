"""REST API AKP Monitor. Документація: /api/docs/ (Swagger), схема: /api/schema/."""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import logging
import re
import secrets
import uuid
import zipfile
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger("akp.security")

from . import rules as R
from .access import (AUDIT, CONTENT_EDIT, MEASURE_MANAGE, SURVEYS, SURVEYS_EDIT, SURVEYS_VIEW,
                     TECH, VIEW_ALL, can_see_measure, profile, require, scoped_measures)
from .key_crypto import calculate_public_key_fingerprint, verify_key_signature
from .models import (AuditLog, Comment, DeadlineChange, Evidence, Execution, Measure, Profile, Program,
                     Recommendation, ReportingPeriod, Risk, Role, Section, Survey, SystemSettings, Unit,
                     UserAccessKey)
from .surveys import compare as compare_surveys
from .surveys import group_options, parse_csv, parse_survey_file

STATUS_NAMES = dict(Execution.Status.choices)
# Суворий білий список безпечних форматів документів і підтверджень
ALLOWED_EVIDENCE_EXTS = {
    ".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg"
}
# Явно заблоковані небезпечні формати: макроси, виконувані файли, веб-скрипти
BLOCKED_EVIDENCE_EXTS = {
    ".docm", ".xlsm", ".pptm", ".exe", ".sh", ".js", ".svg", ".html",
    ".htm", ".bat", ".cmd", ".vbs", ".ps1", ".jar", ".msi", ".dll", ".scr",
}
MAX_EVIDENCE_BYTES = 20 * 1024 * 1024
LOGIN_WINDOW_SEC = 60
LOGIN_MAX_USER_FAILS = 10
LOGIN_MAX_IP_FAILS = 30
_HTTP_URL_VALIDATOR = URLValidator(schemes=["http", "https"])
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
_PURE_NUM_RE = re.compile(r"^[+-]?\d+(?:[.,]\d+)?$")


def _validate_evidence_file(f, ext: str):
    """Сувора валідація Magic Bytes (сигнатур файлів) та блокування макросів / шкідливого коду."""
    pos = f.tell()
    try:
        f.seek(0)
        header = f.read(32)
        f.seek(0)

        if ext == ".pdf":
            if not header.startswith(b"%PDF"):
                raise ValidationError({"file": "Вміст файлу не відповідає формату PDF (невірний заголовок файлу)."})
        elif ext == ".png":
            if not header.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValidationError({"file": "Вміст файлу не відповідає формату PNG (невірний заголовок файлу)."})
        elif ext in (".jpg", ".jpeg"):
            if not header.startswith(b"\xff\xd8\xff"):
                raise ValidationError({"file": "Вміст файлу не відповідає формату JPEG (невірний заголовок файлу)."})
        elif ext in (".docx", ".xlsx"):
            if not header.startswith(b"PK\x03\x04"):
                raise ValidationError({"file": f"Вміст файлу не відповідає формату {ext.upper()} (очікується валідний архів OpenXML)."})
            try:
                f.seek(0)
                with zipfile.ZipFile(f, "r") as zf:
                    namelist = zf.namelist()
                    for name in namelist:
                        lower_name = name.lower()
                        # Блокування файлів із макросами (VBA) та виконуваними скриптами всередині архіву
                        if "vbaproject.bin" in lower_name or lower_name.endswith(
                            (".vba", ".bas", ".cls", ".exe", ".sh", ".js", ".bat", ".cmd", ".ps1")
                        ):
                            raise ValidationError({"file": "Файл містить заборонені макроси або виконувані елементи (VBA)."})
                    if ext == ".docx":
                        if not any(n.startswith("word/") or n == "[Content_Types].xml" for n in namelist):
                            raise ValidationError({"file": "Вміст файлу не відповідає структурі документа DOCX."})
                    elif ext == ".xlsx":
                        if not any(n.startswith("xl/") or n == "[Content_Types].xml" for n in namelist):
                            raise ValidationError({"file": "Вміст файлу не відповідає структурі таблиці XLSX."})
            except zipfile.BadZipFile:
                raise ValidationError({"file": f"Пошкоджений або некоректний архів {ext.upper()}."})
    finally:
        f.seek(pos)


def _parse_date(val, field="date", allow_empty=False) -> date | None:
    if val in (None, ""):
        if allow_empty:
            return None
        raise ValidationError({field: "Вкажіть коректну дату у форматі РРРР-ММ-ДД."})
    try:
        return date.fromisoformat(str(val).strip())
    except (ValueError, TypeError):
        raise ValidationError({field: "Невірний формат дати (очікується РРРР-ММ-ДД)."})


def _parse_float(val, field="value") -> float | None:
    if val in (None, ""):
        return None
    try:
        res = float(val)
    except (ValueError, TypeError):
        raise ValidationError({field: "Вкажіть числове значення."})
    if res != res or res in (float("inf"), float("-inf")):
        raise ValidationError({field: "Недопустиме числове значення."})
    return res


def _parse_int(val, field="value", min_val: int | None = None, max_val: int | None = None) -> int:
    try:
        res = int(val)
    except (ValueError, TypeError):
        raise ValidationError({field: "Вкажіть ціле число."})
    if min_val is not None and res < min_val:
        raise ValidationError({field: f"Значення має бути не менше {min_val}."})
    if max_val is not None and res > max_val:
        raise ValidationError({field: f"Значення має бути не більше {max_val}."})
    return res


def _validate_http_url(raw: str | None, field="link") -> str:
    val = (raw or "").strip()
    if not val:
        return ""
    try:
        _HTTP_URL_VALIDATOR(val)
    except DjangoValidationError:
        raise ValidationError({field: "Посилання має починатися з https:// або http://."})
    return val


def _sanitize_export_cell(v):
    """Захист CSV/XLSX від інʼєкцій формул (OWASP CWE-1236)."""
    if v is None:
        return ""
    if isinstance(v, str):
        stripped = v.lstrip()
        if (v.startswith(_FORMULA_PREFIXES) or (stripped and stripped.startswith(_FORMULA_PREFIXES))) and not _PURE_NUM_RE.match(v.strip()):
            return "'" + v
    return v


def _client_ip(request) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[0].strip()[:64]
    return (request.META.get("REMOTE_ADDR") or "unknown")[:64]


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
    fname = Path(e.file.name).name if e.file else None
    # Прапорець дубліката: файл із таким SHA-256 прикріплено до іншого заходу
    is_dup = False
    dup_measures = []
    if e.file and e.sha256:
        dups = Evidence.objects.filter(sha256=e.sha256).exclude(pk=e.pk).exclude(measure=e.measure).select_related("measure")
        if dups.exists():
            is_dup = True
            dup_measures = [{"code": d.code, "measure": d.measure.code} for d in dups[:5]]
    return {"id": e.id, "code": e.code, "type": e.type, "title": e.title, "doc_date": e.doc_date,
            "link": e.link, "file": f"/api/evidence/{e.code}/file" if e.file else None,
            "filename": fname, "uploaded_at": e.uploaded_at,
            "uploaded_by": e.uploaded_by.code if e.uploaded_by else None, "sha256": e.sha256,
            "period": e.period.code if e.period else None,
            "is_duplicate": is_dup, "duplicate_in": dup_measures}


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
        "result_text": (s.execution.result_text if s.execution else "") or "",
        "portal_state": R.portal_state(s, period.end),
        "flags": flags_by_m.get(m.code, []),
        "nonexecution_risk": R.nonexecution_risk(s, today, overdue_units),
        "is_excluded": getattr(m, "is_excluded", False),
        "exclusion_reason": getattr(m, "exclusion_reason", ""),
        "excluded_at": m.excluded_at.isoformat() if getattr(m, "excluded_at", None) else None,
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
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def csrf_token_view(request):
    """Повертає дійсний CSRF-токен та встановлює cookie csrftoken для фронтенд-клієнта."""
    token = get_token(request)
    return Response({"ok": True, "csrfToken": token})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def public_overview(request):
    """Публічний огляд антикорупційної програми (із гарантованою видачею csrftoken)."""
    pr = Program.objects.select_related("organ", "coordinator_unit").first()
    cur_p = default_period()
    total_measures = Measure.objects.filter(is_excluded=False).count()
    sections = [
        {"code": sec.code, "number": sec.number, "name": sec.portal_name}
        for sec in (pr.sections.all() if pr else [])
    ]
    return Response({
        "ok": True,
        "csrfToken": get_token(request),
        "program": {
            "title": pr.name if pr else "Антикорупційна програма",
            "organ": pr.organ.name if pr and pr.organ else "ХНУВС",
            "year_start": pr.period_start.year if pr and pr.period_start else 2026,
            "year_end": pr.period_end.year if pr and pr.period_end else 2028,
            "restricted_info": bool(pr.restricted_info) if pr else False,
            "approved": pr.approved if pr else "",
            "nazk_status": pr.nazk_status if pr else "",
        },
        "period": cur_p.code if cur_p else None,
        "total_measures": total_measures,
        "sections": sections,
    })


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def public_measures(request):
    """Публічний реєстр заходів програми для громадськості (якщо не увімкнено обмеження ДСК)."""
    pr = Program.objects.select_related("organ", "coordinator_unit").first()
    if not pr:
        return Response({"restricted": False, "items": [], "sections": []})

    is_restricted = bool(pr.restricted_info)
    if is_restricted:
        return Response({
            "restricted": True,
            "message": "Антикорупційна програма містить інформацію з обмеженим доступом (ІзОД / ДСК). Публікація деталізованого оперативного змісту та результатів виконання заходів обмежена відповідно до законодавства.",
            "program": {
                "title": pr.name,
                "organ": pr.organ.name if pr.organ else "ХНУВС",
                "year_start": pr.period_start.year if pr.period_start else 2026,
                "year_end": pr.period_end.year if pr.period_end else 2028,
                "approved": pr.approved,
            },
            "items": [],
            "sections": [],
        })

    period = get_period(request)
    snaps = R.snapshot(period, Measure.objects.filter(program=pr, is_excluded=False))
    mon = R.monitoring(period, snaps)

    items = []
    for s in snaps:
        m = s.m
        st = R.portal_state(s, period.end)
        latest_opys = (s.execution.result_text if s.execution else "") or ""
        items.append({
            "code": m.code,
            "section": m.section.code,
            "section_name": m.section.portal_name,
            "number": m.number,
            "content": m.content,
            "unit": {"code": m.responsible_unit.code, "name": m.responsible_unit.name},
            "strok_text": m.strok_text,
            "strok_type": m.strok_type,
            "strok_date": m.strok_date,
            "current_deadline": m.current_deadline,
            "status": s.status,
            "status_name": STATUS_NAMES.get(s.status, s.status),
            "portal_state": st,
            "indicator": m.indicator,
            "indicator_unit": m.indicator_unit,
            "indicator_target": m.indicator_target,
            "indicator_fact": s.ind_fakt,
            "result_text": latest_opys,
            "fact_date": s.fakt,
            "evidence_count": len(s.evidence),
        })

    sections = [
        {"code": sec.code, "number": sec.number, "name": sec.portal_name}
        for sec in pr.sections.all()
    ]
    periods = [
        {"code": p.code, "year": p.year, "quarter": p.quarter}
        for p in ReportingPeriod.objects.all().order_by("year", "quarter")
    ]
    return Response({
        "restricted": False,
        "program": {
            "title": pr.name,
            "organ": pr.organ.name if pr.organ else "ХНУВС",
            "year_start": pr.period_start.year if pr.period_start else 2026,
            "year_end": pr.period_end.year if pr.period_end else 2028,
            "approved": pr.approved,
        },
        "period": period.code,
        "periods": periods,
        "total_measures": len(items),
        "items": items,
        "sections": sections,
        "monitoring": mon,
    })


def _check_auth_rate_limit(request, username: str = ""):
    """Перевірка обмеження частоти запитів автентифікації: <= 10 запитів/хв."""
    ip = _client_ip(request)
    ip_hash = hashlib.sha256(ip.encode("utf-8")).hexdigest()[:32]
    ip_key = f"auth_rate:ip:{ip_hash}"
    ip_att = cache.get(ip_key, 0)

    user_key = None
    user_att = 0
    clean_username = re.sub(r"[\r\n\x00-\x1f\x7f-\x9f]", "", str(username or "")).strip().lower()[:64]
    if clean_username:
        user_hash = hashlib.sha256(clean_username.encode("utf-8")).hexdigest()[:32]
        user_key = f"auth_rate:u:{user_hash}"
        user_att = cache.get(user_key, 0)

    if ip_att >= 10 or user_att >= 10:
        return False, ip_key, user_key, ip_att, user_att
    return True, ip_key, user_key, ip_att, user_att


def _bump_auth_rate(ip_key, user_key, ip_att, user_att):
    cache.set(ip_key, ip_att + 1, 60)
    if user_key:
        cache.set(user_key, user_att + 1, 60)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def auth_challenge(request):
    """Генерація одноразового криптографічного виклику (Challenge) для входу за ключем (.key)."""
    raw_login = str(request.data.get("login") or request.data.get("username") or "")
    clean_login = re.sub(r"[\r\n\x00-\x1f\x7f-\x9f]", "", raw_login).strip()
    safe_log_username = clean_login[:30] if clean_login else "unknown"
    login_val = clean_login.lower()[:64]

    raw_fp = str(request.data.get("fingerprint") or "").strip()
    safe_fp = re.sub(r"[^a-fA-F0-9]", "", raw_fp).lower()[:64]

    ok, ip_key, user_key, ip_att, user_att = _check_auth_rate_limit(request, login_val)
    if not ok:
        return Response(
            {"detail": "Забагато спроб входу. Спробуйте пізніше."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    if not login_val:
        _bump_auth_rate(ip_key, user_key, ip_att, user_att)
        AuditLog.write(None, "невдала спроба отримання виклику (порожній логін)", "korystuvach", safe_log_username, field="key_fingerprint", new=safe_fp)
        return Response({"detail": "Вкажіть логін користувача або завантажте файл ключа."}, status=400)

    user = User.objects.filter(Q(username__iexact=login_val) | Q(profile__code__iexact=login_val)).select_related("profile").first()
    if not user or not user.is_active:
        _bump_auth_rate(ip_key, user_key, ip_att, user_att)
        AuditLog.write(None, "невдала спроба отримання виклику (невідомий користувач)", "korystuvach", safe_log_username, field="key_fingerprint", new=safe_fp)
        return Response({"detail": "Користувача не знайдено або відсутній активний ключ доступу."}, status=400)

    keys = user.access_keys.filter(is_revoked=False)
    if safe_fp:
        key = keys.filter(fingerprint=safe_fp).first()
    else:
        key = keys.order_by("-created_at").first()

    if not key:
        _bump_auth_rate(ip_key, user_key, ip_att, user_att)
        AuditLog.write(None, "невдала спроба отримання виклику (немає активного ключа)", "korystuvach", safe_log_username, field="key_fingerprint", new=safe_fp)
        return Response({"detail": "Користувача не знайдено або відсутній активний ключ доступу."}, status=400)

    challenge_raw = secrets.token_bytes(32)
    challenge_b64 = base64.b64encode(challenge_raw).decode("ascii")
    challenge_id = uuid.uuid4().hex

    cache.set(
        f"auth_chal:{challenge_id}",
        {
            "user_id": user.id,
            "key_id": key.id,
            "challenge": challenge_b64,
            "fingerprint": key.fingerprint,
        },
        timeout=120,
    )

    return Response({
        "ok": True,
        "challenge_id": challenge_id,
        "challenge": challenge_b64,
        "fingerprint": key.fingerprint,
        "login": user.username,
        "csrfToken": get_token(request),
    })


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def auth_login_key(request):
    """Автентифікація користувача за цифровим підписом одноразового виклику (Challenge-Response)."""
    raw_login = str(request.data.get("login") or request.data.get("username") or "")
    clean_login = re.sub(r"[\r\n\x00-\x1f\x7f-\x9f]", "", raw_login).strip()
    safe_log_username = clean_login[:30] if clean_login else "unknown"
    login_val = clean_login.lower()[:64]

    challenge_id = str(request.data.get("challenge_id") or "").strip()
    signature_str = str(request.data.get("signature") or "").strip()

    ok, ip_key, user_key, ip_att, user_att = _check_auth_rate_limit(request, login_val)
    if not ok:
        return Response(
            {"detail": "Забагато спроб входу. Спробуйте пізніше."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    if not challenge_id or not signature_str:
        _bump_auth_rate(ip_key, user_key, ip_att, user_att)
        AuditLog.write(None, "невдала спроба входу за ключем (відсутній виклик або підпис)", "korystuvach", safe_log_username)
        return Response({"detail": "Відсутній виклик або підпис ключа."}, status=400)

    # Захист від Replay-атаки: одноразове зчитування та негайне видалення з кешу
    chal_key = f"auth_chal:{challenge_id}"
    chal_data = cache.get(chal_key)
    cache.delete(chal_key)

    if not chal_data:
        _bump_auth_rate(ip_key, user_key, ip_att, user_att)
        AuditLog.write(None, "невдала спроба входу за ключем (застарілий або повторний виклик)", "korystuvach", safe_log_username)
        return Response({"detail": "Виклик застарів або вже використаний. Спробуйте знову."}, status=400)

    user = User.objects.filter(id=chal_data["user_id"]).select_related("profile").first()
    key = user.access_keys.filter(id=chal_data["key_id"], is_revoked=False).first() if user else None

    if not user or not user.is_active or not key:
        _bump_auth_rate(ip_key, user_key, ip_att, user_att)
        AuditLog.write(None, "невдала спроба входу за ключем (користувач неактивний або ключ відкликано)", "korystuvach", safe_log_username)
        return Response({"detail": "Обліковий запис заблоковано або ключ відкликано."}, status=400)

    try:
        sig_bytes = base64.b64decode(signature_str)
        challenge_bytes = base64.b64decode(chal_data["challenge"])
    except Exception:
        _bump_auth_rate(ip_key, user_key, ip_att, user_att)
        AuditLog.write(None, "невдала спроба входу за ключем (некоректне base64-кодування)", "korystuvach", safe_log_username, field="key_fingerprint", new=key.fingerprint)
        return Response({"detail": "Недійсний формат підпису."}, status=400)

    is_valid = verify_key_signature(key.public_key_pem, challenge_bytes, sig_bytes)
    if not is_valid:
        _bump_auth_rate(ip_key, user_key, ip_att, user_att)
        AuditLog.write(None, f"невдала спроба входу за ключем (недійсний підпис: {key.fingerprint[:16]}...)", "korystuvach", safe_log_username, field="key_fingerprint", new=key.fingerprint)
        return Response({"detail": "Недійсний цифровий підпис ключа."}, status=400)

    if user_key:
        cache.delete(user_key)

    token, _ = Token.objects.get_or_create(user=user)
    AuditLog.write(
        user.profile,
        f"успішний вхід за ключем ({key.fingerprint[:16]}...)",
        "korystuvach",
        user.profile.code,
        field="key_fingerprint",
        new=key.fingerprint,
    )

    return Response({
        "ok": True,
        "token": token.key,
        "profile": profile_dict(user.profile),
        "key_fingerprint": key.fingerprint,
        "csrfToken": get_token(request),
    })


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def login(request):
    """Класичний вхід за паролем повністю вимкнено згідно з вимогами безпеки."""
    raw_username = str(request.data.get("username") or "")
    clean_username = re.sub(r"[\r\n\x00-\x1f\x7f-\x9f]", "", raw_username).strip()
    safe_log_username = clean_username[:30] if clean_username else "unknown"

    # Якщо клієнт випадково надіслав виклик/підпис на цей ендпоінт, перенаправляємо
    if request.data.get("signature") and request.data.get("challenge_id"):
        return auth_login_key(request)

    AuditLog.write(None, "спроба застарілого входу за паролем (заблоковано)", "korystuvach", safe_log_username)
    return Response(
        {"detail": "Класичний вхід лише за паролем вимкнено. Скористайтеся авторизацією за файлом особистого ключа (.key)."},
        status=status.HTTP_400_BAD_REQUEST,
    )



@api_view(["POST"])
def logout(request):
    p = getattr(request.user, "profile", None)
    Token.objects.filter(user=request.user).delete()
    if p:
        AuditLog.write(p, "вихід із системи", "korystuvach", p.code)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def demo_users(request):
    """Список демо-облікових записів для сторінки входу (лише синтетичні ролі, без імен)."""
    if not getattr(settings, "AKP_DEMO_MODE", True):
        return Response([])
    return Response([
        {
            "code": p.code,
            "username": p.user.username,
            "role": p.role,
            "role_name": p.get_role_display(),
            "unit": unit_dict(p.unit),
            "position": p.position,
        }
        for p in Profile.objects.select_related("unit", "user").order_by("code")
        if p.user.is_active
    ])


@api_view(["GET"])
@ensure_csrf_cookie
def me(request):
    p = profile(request)
    today = SystemSettings.today()
    per = default_period()
    return Response({
        "profile": profile_dict(p),
        "today": today,
        "current_period": period_dict(per, today),
        "csrfToken": get_token(request),
    })


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


@api_view(["GET", "POST"])
def units(request):
    p = profile(request)
    if request.method == "POST":
        p = require(request, {Role.KOORD, Role.ADMIN}, "Створювати підрозділи можуть уповноважений або технічний адміністратор.")
        code = (request.data.get("code") or "").strip().upper()
        name = (request.data.get("name") or "").strip()
        type_val = (request.data.get("type") or "").strip()
        note = (request.data.get("note") or "").strip()

        if not code:
            raise ValidationError({"code": "Вкажіть код підрозділу (наприклад, P15 або ВЗГ)."})
        if len(code) > 10:
            raise ValidationError({"code": "Код підрозділу не може бути довшим за 10 символів."})
        if Unit.objects.filter(code__iexact=code).exists():
            raise ValidationError({"code": f"Підрозділ із кодом «{code}» уже існує в системі."})
        if not name:
            raise ValidationError({"name": "Вкажіть назву підрозділу."})

        pr = Program.objects.select_related("organ").first()
        organ = pr.organ if (pr and pr.organ) else Organ.objects.first()
        if not organ:
            organ = Organ.objects.create(name="ХНУВС")

        with transaction.atomic():
            u = Unit.objects.create(code=code, organ=organ, name=name, type=type_val, note=note)
            AuditLog.write(
                p,
                "створено підрозділ",
                "pidrozdil",
                u.code,
                field="name",
                old="",
                new=f"{u.code}: {u.name}" + (f" ({u.type})" if u.type else ""),
            )

        return Response({
            "code": u.code,
            "name": u.name,
            "type": u.type,
            "note": u.note,
            "measures_count": 0,
        }, status=status.HTTP_201_CREATED)

    # GET
    res = []
    for u in Unit.objects.all().order_by("code"):
        res.append({
            "code": u.code,
            "name": u.name,
            "type": u.type,
            "note": u.note,
            "measures_count": u.measures.count(),
        })
    return Response(res)


@api_view(["PATCH", "PUT"])
def unit_update(request, code):
    p = require(request, {Role.KOORD, Role.ADMIN}, "Редагувати підрозділи можуть уповноважений або технічний адміністратор.")
    u = get_object_or_404(Unit, code__iexact=code.strip())
    d = request.data
    changes = []

    with transaction.atomic():
        if "name" in d:
            new_name = (d["name"] or "").strip()
            if not new_name:
                raise ValidationError({"name": "Назва підрозділу не може бути порожньою."})
            if new_name != u.name:
                AuditLog.write(p, "змінено назву підрозділу", "pidrozdil", u.code, "name", u.name, new_name)
                u.name = new_name
                changes.append("name")
        if "type" in d:
            new_type = (d["type"] or "").strip()
            if new_type != u.type:
                AuditLog.write(p, "змінено тип підрозділу", "pidrozdil", u.code, "type", u.type, new_type)
                u.type = new_type
                changes.append("type")
        if "note" in d:
            new_note = (d["note"] or "").strip()
            if new_note != u.note:
                AuditLog.write(p, "змінено примітку підрозділу", "pidrozdil", u.code, "note", u.note, new_note)
                u.note = new_note
                changes.append("note")
        if changes:
            u.save()

    return Response({
        "code": u.code,
        "name": u.name,
        "type": u.type,
        "note": u.note,
        "measures_count": u.measures.count(),
    })


@api_view(["GET"])
def periods(request):
    profile(request)
    today = SystemSettings.today()
    return Response([period_dict(p, today) for p in ReportingPeriod.objects.all()])


@api_view(["PATCH"])
def period_update(request, code):
    p = require(request, TECH | CONTENT_EDIT, "Звітні вікна налаштовує технічний адміністратор або уповноважений.")
    per = get_object_or_404(ReportingPeriod, code=code)
    changes = []
    for f in ("force_open", "window_start", "window_end"):
        if f in request.data:
            old = getattr(per, f)
            new = bool(request.data[f]) if f == "force_open" else _parse_date(request.data[f], field=f)
            if old != new:
                setattr(per, f, new)
                changes.append((f, old, new))
    if per.window_end < per.window_start:
        raise ValidationError({"window_end": "Кінець вікна не може бути раніше за початок."})
    if changes:
        per.save()
        for f, old, new in changes:
            AuditLog.write(p, "змінено звітне вікно", "period", per.code, f, old, new)
    return Response(period_dict(per))


@api_view(["GET", "PATCH"])
def system_settings(request):
    s = SystemSettings.get()
    if request.method == "PATCH":
        p = require(request, TECH, "Налаштування змінює технічний адміністратор.")
        limits = {
            "window_days": (1, 60),
            "reminder_days": (1, 180),
            "min_survey_group": (3, 100),
        }
        for f in ("today_override", "window_days", "reminder_days", "min_survey_group", "signatory_name", "head_signatory_name", "izod_audit_mode"):
            if f in request.data:
                v = request.data[f]
                if f == "today_override":
                    v = _parse_date(v, field=f, allow_empty=True)
                elif f in ("signatory_name", "head_signatory_name"):
                    v = str(v or "").strip()[:200]
                elif f == "izod_audit_mode":
                    v = bool(v)
                else:
                    lo, hi = limits[f]
                    v = _parse_int(v, field=f, min_val=lo, max_val=hi)
                if getattr(s, f) != v:
                    AuditLog.write(p, "змінено налаштування", "nalashtuvannia", "system", f, getattr(s, f), v)
                    setattr(s, f, v)
        s.save()
    else:
        profile(request)
    sig1, sig2 = SystemSettings.signatories()
    return Response({"today_override": s.today_override, "today": SystemSettings.today(),
                     "window_days": s.window_days, "reminder_days": s.reminder_days,
                     "min_survey_group": s.min_survey_group,
                     "signatory_name": sig1,
                     "head_signatory_name": sig2,
                     "izod_audit_mode": s.izod_audit_mode,
                     "is_izod_active": SystemSettings.is_izod_active()})


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
    if q.get("show_excluded") != "1":
        items = [i for i in items if not i.get("is_excluded")]
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
    require(request, MEASURE_MANAGE, "Планувати та редагувати заходи може уповноважений та адміністратор.")
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
    strok_type = d.get("strok_type", "data")
    if strok_type not in dict(Measure.STROK_TYPES):
        raise ValidationError({"strok_type": "Невідомий тип строку."})
    m = Measure.objects.create(
        code=code, program=pr, section=sec, number=sec.measures.count() + 1, content=str(d.get("content", "")).strip(),
        risk=risk, responsible_unit=unit, strok_text=str(d.get("strok_text", "")).strip()[:100], strok_type=strok_type,
        strok_date=_parse_date(d.get("strok_date"), field="strok_date", allow_empty=True),
        indicator=str(d.get("indicator", "")).strip()[:500], indicator_unit=str(d.get("indicator_unit", "")).strip()[:20],
        indicator_target=_parse_float(d.get("indicator_target"), field="indicator_target"),
        required_evidence=str(d.get("required_evidence", "")).strip()[:500],
        resources=str(d.get("resources", "")).strip()[:300])
    if "co_units" in d and isinstance(d["co_units"], list):
        m.co_units.set(Unit.objects.filter(code__in=d["co_units"]))
    AuditLog.write(p, "створено захід", "zakhid", m.code, "content", "", m.content[:140])
    return Response({"code": m.code, "number": m.number, "section": m.section.code}, status=201)


@api_view(["GET", "PATCH", "DELETE"])
def measure_detail(request, code):
    p = profile(request)
    m = get_object_or_404(Measure.objects.select_related("section", "risk", "responsible_unit", "excluded_by"), code=code)
    if not can_see_measure(p, m):
        raise PermissionDenied("Цей захід належить іншому підрозділу.")
    if request.method == "GET" and SystemSettings.is_izod_active():
        from datetime import timedelta
        recent = AuditLog.objects.filter(
            actor=p,
            action="перегляд картки заходу",
            obj_id=m.code,
            ts__gte=timezone.now() - timedelta(seconds=10)
        ).exists()
        if not recent:
            AuditLog.write(
                p,
                "перегляд картки заходу",
                "zakhid",
                m.code,
                field="kartka",
                old="",
                new=f"Картка {m.code} ({m.responsible_unit.code if m.responsible_unit else ''}): {m.content[:80]}",
            )
    if request.method == "PATCH":
        require(request, MEASURE_MANAGE, "Змінювати параметри заходу може уповноважений та адміністратор.")
        editable = ["content", "strok_text", "indicator", "indicator_unit", "required_evidence", "resources", "strok_type"]
        for f in editable:
            if f in request.data and request.data[f] != getattr(m, f):
                AuditLog.write(p, "змінено захід", "zakhid", m.code, f, getattr(m, f), request.data[f])
                setattr(m, f, request.data[f])
        if "strok_date" in request.data:
            new_date = _parse_date(request.data["strok_date"], field="strok_date", allow_empty=True)
            if m.strok_date != new_date:
                AuditLog.write(p, "змінено захід", "zakhid", m.code, "strok_date", str(m.strok_date or ""), str(new_date or ""))
                m.strok_date = new_date
        if "indicator_target" in request.data:
            v = _parse_float(request.data["indicator_target"], field="indicator_target")
            if m.indicator_target != v:
                AuditLog.write(p, "змінено захід", "zakhid", m.code, "indicator_target", str(m.indicator_target or ""), str(v or ""))
                m.indicator_target = v
        if "unit" in request.data:
            u_obj = Unit.objects.filter(code=request.data["unit"]).first()
            if u_obj and m.responsible_unit_id != u_obj.id:
                AuditLog.write(p, "змінено відповідальний підрозділ", "zakhid", m.code, "responsible_unit", m.responsible_unit.code, u_obj.code)
                m.responsible_unit = u_obj
        if "risk" in request.data:
            r_obj = Risk.objects.filter(code=request.data["risk"]).first() if request.data["risk"] else None
            old_r = m.risk.code if m.risk else ""
            new_r = r_obj.code if r_obj else ""
            if old_r != new_r:
                AuditLog.write(p, "змінено прив'язку до ризику", "zakhid", m.code, "risk", old_r, new_r)
                m.risk = r_obj
        if "section" in request.data:
            sec_obj = Section.objects.filter(code=request.data["section"]).first()
            if sec_obj and m.section_id != sec_obj.id:
                AuditLog.write(p, "змінено розділ заходу", "zakhid", m.code, "section", m.section.code, sec_obj.code)
                m.section = sec_obj
        if "co_units" in request.data and isinstance(request.data["co_units"], list):
            new_cos = list(Unit.objects.filter(code__in=request.data["co_units"]))
            old_cos_str = ",".join(sorted(u.code for u in m.co_units.all()))
            new_cos_str = ",".join(sorted(u.code for u in new_cos))
            if old_cos_str != new_cos_str:
                AuditLog.write(p, "змінено співвиконавців заходу", "zakhid", m.code, "co_units", old_cos_str, new_cos_str)
                m.co_units.set(new_cos)
        m.save()

    if request.method == "DELETE":
        require(request, MEASURE_MANAGE, "Виключати або видаляти захід може уповноважений та адміністратор.")
        has_evidence = m.evidence.exists()
        has_approved = m.executions.filter(approval="approved").exists()
        reason = ""
        if isinstance(request.data, dict):
            reason = request.data.get("reason") or ""
        if not reason and request.query_params.get("reason"):
            reason = request.query_params.get("reason") or ""
        reason = str(reason).strip()

        if has_evidence or has_approved:
            if not reason:
                return Response({
                    "detail": "Захід має завантажені незмінні підтвердження (Evidence) або погоджені звіти. "
                              "Для виключення заходу з програми обов'язково зазначте підставу "
                              "(наприклад: номер та дату наказу/розпорядження).",
                    "requires_reason": True,
                }, status=400)
            m.is_excluded = True
            m.exclusion_reason = reason
            m.excluded_at = timezone.now()
            m.excluded_by = p
            m.save()
            AuditLog.write(
                p,
                "виключено захід із програми",
                "zakhid",
                m.code,
                "is_excluded",
                "False",
                f"True: {reason}"[:140],
            )
            return Response({
                "status": "excluded",
                "code": m.code,
                "message": f"Захід {m.code} успішно виключено з антикорупційної програми (Підстава: {reason}). "
                           "Історичні дані та незмінні докази збережено.",
            })
        else:
            m_code = m.code
            m_content = m.content
            AuditLog.write(p, "видалено захід", "zakhid", m_code, "content", m_content[:80], "")
            m.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
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
        "comments": [{"id": c.id,
                      "author": c.author.code if c.author else (c.author_code or "—"),
                      "author_role": c.author.get_role_display() if c.author else (c.author_role_name or ""),
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
        "is_excluded": getattr(m, "is_excluded", False),
        "exclusion_reason": getattr(m, "exclusion_reason", ""),
        "excluded_at": m.excluded_at.isoformat() if getattr(m, "excluded_at", None) else None,
        "excluded_by": m.excluded_by.code if getattr(m, "excluded_by", None) else None,
    })
    if m.risk:
        r = m.risk
        data["risk_detail"] = {"code": r.code, "name": r.name, "level": r.level, "indicator": r.indicator,
                               "unit": r.indicator_unit, "baseline": r.baseline, "target": r.target,
                               "current": r.value_on(period.end), "progress": r.progress_on(period.end),
                               "history": [{"date": x.date, "value": x.value} for x in r.measurements.all()]}
    return Response(data)


def _can_edit_execution(p, m, period):
    if p.role in (Role.KOORD, Role.ADMIN):
        return {"allowed": True, "reason": "уповноважений та адміністратор можуть вносити зміни в будь-який час"}
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
            changes["fact_date"] = _parse_date(d["fact_date"], field="fact_date", allow_empty=True)
        if "result_text" in d:
            changes["result_text"] = (d["result_text"] or "").strip()
        if "indicator_fact" in d:
            changes["indicator_fact"] = _parse_float(d["indicator_fact"], field="indicator_fact")
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
    title = str(d.get("title") or "").strip()[:500]
    if not title or not d.get("doc_date"):
        raise ValidationError({"title": "Вкажіть назву і дату документа."})
    doc_date = _parse_date(d.get("doc_date"), field="doc_date")
    link = _validate_http_url(d.get("link"), field="link")
    f = request.FILES.get("file")
    h = hashlib.sha256()
    if f:
        if f.size > MAX_EVIDENCE_BYTES:
            raise ValidationError({"file": "Розмір файлу не повинен перевищувати 20 МБ."})
        ext = Path(str(f.name or "")).suffix.lower()
        if ext in BLOCKED_EVIDENCE_EXTS:
            raise ValidationError({"file": f"Файли типу {ext} (виконувані файли, скрипти та файли з макросами) суворо заборонені з міркувань кібербезпеки."})
        if ext not in ALLOWED_EVIDENCE_EXTS:
            allowed_str = ", ".join(sorted(ALLOWED_EVIDENCE_EXTS))
            raise ValidationError({"file": f"Неприпустимий тип файлу ({ext or 'без розширення'}). Дозволені лише безпечні формати: {allowed_str}."})
        _validate_evidence_file(f, ext)
        for chunk in f.chunks():
            h.update(chunk)
        f.seek(0)
    n = Evidence.objects.count() + 1
    code_e = f"E-{n:03d}"
    while Evidence.objects.filter(code=code_e).exists():
        n += 1
        code_e = f"E-{n:03d}"
    if not f:
        h.update(f"{code_e}|{m.code}|{title}|{doc_date.isoformat()}".encode("utf-8"))
    file_sha = h.hexdigest()

    # Детектор дублювання: перевірка чи файл з таким же SHA-256 вже прикріплено до іншого заходу
    duplicate_warning = None
    if f:
        existing_dups = Evidence.objects.filter(sha256=file_sha).exclude(measure=m).select_related("measure")
        if existing_dups.exists():
            dup_codes = [f"{d.code} (захід {d.measure.code})" for d in existing_dups[:5]]
            duplicate_warning = (
                f"Файл із таким самим SHA-256 вже прикріплено до інших заходів: {', '.join(dup_codes)}. "
                f"Завантаження дозволено, але перевірте, чи це не помилкове дублювання."
            )

    e = Evidence(code=code_e, measure=m, period=period, type=str(d.get("type") or "документ").strip()[:50],
                 title=title, doc_date=doc_date, link=link,
                 uploaded_at=timezone.now(), uploaded_by=p, sha256=file_sha)
    if f:
        e.file = f
    e.save()
    AuditLog.write(p, "завантажено підтвердний матеріал", "pidtverdzhennia", e.code, "sha256", "", e.sha256)
    resp = evidence_dict(e)
    if duplicate_warning:
        resp["duplicate_warning"] = duplicate_warning
    return Response(resp, status=201)


@api_view(["GET"])
def evidence_verify(request, code):
    require(request, VIEW_ALL)
    e = get_object_or_404(Evidence, code=code)
    return Response({"code": e.code, "sha256": e.sha256, "file_ok": e.verify()})


@api_view(["GET"])
def evidence_file(request, code):
    p = profile(request)
    e = get_object_or_404(Evidence.objects.select_related("measure"), code=code)
    if not can_see_measure(p, e.measure):
        raise PermissionDenied("Немає доступу до матеріалів іншого підрозділу.")
    if not e.file:
        return Response({"detail": "Файл до цього запису не прикріплено."}, status=404)
    try:
        fh = e.file.open("rb")
    except OSError:
        return Response({"detail": "Файл підтвердження не знайдено на диску."}, status=404)
    raw_fname = Path(e.file.name).name
    # Очищення імені файлу: лише безпечні символи, захист від Header Injection (CWE-113) та Path Traversal
    safe_fname = re.sub(r'[^a-zA-Z0-9а-яА-ЯіїєґІЇЄҐ._ -]', '_', raw_fname).strip()
    if not safe_fname or safe_fname.startswith('.'):
        safe_fname = f"evidence_{e.code}{Path(raw_fname).suffix}"

    is_anal = bool(p and p.role == Role.ANAL)
    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    if SystemSettings.is_izod_active() or is_anal:
        AuditLog.write(
            p,
            "завантаження підтвердного документа",
            "pidtverdzhennia",
            e.code,
            field="file",
            old="",
            new=f"Файл: {safe_fname} (захід {e.measure.code}, SHA-256: {e.sha256[:12]}…)",
        )

    # Якщо завантажує ANAL і файл є документом Word (.docx) — вбудовуємо персоналізований цифровий слід
    if is_anal and safe_fname.lower().endswith(".docx"):
        try:
            from docx import Document
            from . import docgen as D
            raw_data = fh.read()
            fh.close()
            doc = Document(io.BytesIO(raw_data))
            D.apply_analyst_watermark(doc, p)
            out_buf = io.BytesIO()
            doc.save(out_buf)
            resp = HttpResponse(
                out_buf.getvalue(),
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            resp["Content-Disposition"] = f'attachment; filename="{safe_fname}"'
            resp["X-Content-Type-Options"] = "nosniff"
            resp["Content-Security-Policy"] = "default-src 'none'; sandbox"
            resp["X-Digital-Footprint"] = f"ANAL · {p.code} · {now_str}"
            resp["X-IzOD-Watermark"] = f"ІзОД / ДСК · ANAL · {p.code} · {now_str}"
            return resp
        except Exception:
            fh = e.file.open("rb")

    resp = FileResponse(fh, as_attachment=True, filename=safe_fname)
    resp["Content-Disposition"] = f'attachment; filename="{safe_fname}"'
    resp["X-Content-Type-Options"] = "nosniff"
    resp["Content-Security-Policy"] = "default-src 'none'; sandbox"
    if is_anal:
        resp["X-Digital-Footprint"] = f"ANAL · {p.code} · {now_str}"
        resp["X-IzOD-Watermark"] = f"ІзОД / ДСК · ANAL · {p.code} · {now_str}"
    return resp


@api_view(["POST"])
def comment_add(request, code):
    p = profile(request)
    m = get_object_or_404(Measure, code=code)
    if not can_see_measure(p, m) or p.role in (Role.KER, Role.ANAL):
        raise PermissionDenied("Коментувати можуть виконавець заходу, уповноважений та адміністратор.")
    text = (request.data.get("text") or "").strip()
    if not text:
        raise ValidationError({"text": "Порожній коментар."})
    c = Comment.objects.create(measure=m, period=get_period(request), author=p, text=text,
                               is_remark=p.role in (Role.KOORD, Role.ADMIN))
    AuditLog.write(p, "додано коментар", "zakhid", m.code, "comment", "", text)
    return Response({"id": c.id}, status=201)


@api_view(["POST"])
def deadline_change(request, code):
    p = require(request, CONTENT_EDIT, "Перенесення строку погоджує уповноважений.")
    m = get_object_or_404(Measure, code=code)
    if m.strok_type != "data":
        raise ValidationError({"new_date": "Перенести можна лише строк, визначений датою."})
    new = _parse_date(request.data.get("new_date"), field="new_date")
    reason = str(request.data.get("reason") or "").strip()[:500]
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
    if p.role in (Role.VYK, Role.KOORD, Role.ADMIN):
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
    if p.role in (Role.KOORD, Role.ADMIN):
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
                     "can_decide": p.role in (Role.KOORD, Role.ADMIN)})


@api_view(["POST"])
def recommendation_decide(request, pk):
    p = require(request, CONTENT_EDIT, "Рішення щодо рекомендацій ухвалює уповноважений.")
    r = get_object_or_404(Recommendation, pk=pk)
    state = request.data.get("state")
    if state not in dict(Recommendation.State.choices):
        raise ValidationError({"state": "Невідомий стан."})
    if state == "accepted":
        unit = Unit.objects.filter(code=request.data.get("responsible_unit")).first()
        due = _parse_date(request.data.get("due_date"), field="due_date", allow_empty=True)
        if not unit or not due:
            raise ValidationError({"detail": "Прийнята рекомендація має мати відповідального і строк."})
        r.responsible_unit, r.due_date = unit, due
    if state == "rejected" and not (request.data.get("comment") or "").strip():
        raise ValidationError({"comment": "Вкажіть причину відхилення."})
    AuditLog.write(p, "рішення щодо рекомендації", "rekomendatsiia", r.key, "state", r.state, state)
    r.state, r.decided_by, r.decided_at = state, p, timezone.now()
    r.decision_comment = request.data.get("comment", r.decision_comment)
    r.save()
    return Response({"ok": True})


# ---------------------------------------------------------------- звіти й експорт
def _xlsx_response(filename, sheets, user_profile=None):
    from openpyxl.drawing.image import Image as OpenpyxlImage
    from .docgen import generate_watermark_png
    wb = Workbook()
    wb.remove(wb.active)
    head_fill = PatternFill("solid", fgColor="0B2A5B")
    is_anal = bool(user_profile and getattr(user_profile, "role", None) == Role.ANAL)
    now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
    u_code = getattr(user_profile, "code", "SYS")
    u_role = getattr(user_profile, "role", "ANAL")
    h = hashlib.sha256(f"{u_code}:{u_role}:{now_str}:{filename}".encode()).hexdigest()[:12]
    stamp = f"ІзОД / ДСК · {u_code} · {u_role} · {now_str} · SHA-256: {h}"

    wm_png_bytes = None
    try:
        wm_png_bytes = generate_watermark_png(stamp, width=1200, height=800)
    except Exception:
        pass

    for title, header, data in sheets:
        ws = wb.create_sheet(title[:31])
        ws.oddHeader.right.text = f"{stamp} · ДСК"
        ws.oddFooter.right.text = f"Вивантажено: {stamp} · ІзОД"
        ws.oddFooter.left.text = "ДЛЯ СЛУЖБОВОГО КОРИСТУВАННЯ"
        if wm_png_bytes:
            try:
                ws.add_image(OpenpyxlImage(io.BytesIO(wm_png_bytes)), "B4")
            except Exception:
                pass
        ws.protection.sheet = True
        ws.protection.password = "AKP_IZOD_PROTECTED"
        ws.protection.enable()

        ws.append([_sanitize_export_cell(h) for h in header])
        for c in ws[1]:
            c.font = Font(name="Times New Roman", size=12, bold=True, color="FFFFFF")
            c.fill = head_fill
            c.alignment = Alignment(wrap_text=True, vertical="top")
        for row in data:
            ws.append([_sanitize_export_cell(v) for v in row])
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
    if is_anal:
        resp["X-Digital-Footprint"] = f"ANAL · {u_code} · {now_str}"
        resp["X-IzOD-Watermark"] = f"ІзОД / ДСК · ANAL · {u_code} · {now_str}"
    return resp


def _docx_response(filename, content: bytes, user_profile=None):
    resp = HttpResponse(content, content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    if user_profile and getattr(user_profile, "role", None) == Role.ANAL:
        now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
        resp["X-Digital-Footprint"] = f"ANAL · {user_profile.code} · {now_str}"
        resp["X-IzOD-Watermark"] = f"ІзОД / ДСК · ANAL · {user_profile.code} · {now_str}"
    return resp


def _csv_response(filename, header, data, user_profile=None):
    buf = io.StringIO()
    w = csv.writer(buf)
    is_anal = bool(user_profile and getattr(user_profile, "role", None) == Role.ANAL)
    if is_anal:
        now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
        w.writerow([f"# ANAL · {user_profile.code} · {now_str} · ІзОД / ДСК"])
    w.writerow([_sanitize_export_cell(h) for h in header])
    w.writerows([[_sanitize_export_cell(v) for v in row] for row in data])
    resp = HttpResponse("\ufeff" + buf.getvalue(), content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    if is_anal:
        now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
        resp["X-Digital-Footprint"] = f"ANAL · {user_profile.code} · {now_str}"
        resp["X-IzOD-Watermark"] = f"ІзОД / ДСК · ANAL · {user_profile.code} · {now_str}"
    return resp


@api_view(["GET"])
def report_portal(request):
    """Звіт за півріччя у структурі Порталу доброчесності НАЗК."""
    require(request, VIEW_ALL)
    year = _parse_int(request.query_params.get("year", 2026), field="year", min_val=2000, max_val=2100)
    half = _parse_int(request.query_params.get("half", 1), field="half", min_val=1, max_val=2)
    pr = Program.objects.first()
    rows = R.portal_report(pr, year, half)
    fmt = request.query_params.get("format", "json")
    keys = [k for k, _ in R.REPORT_COLUMNS]
    names = [n for _, n in R.REPORT_COLUMNS]
    fname = f"zvit_portal_{year}_h{half}"

    from . import verification as V
    user_p = profile(request)
    base_url = request.build_absolute_uri("/").rstrip("/")
    snapshot = V.get_or_create_portal_snapshot(year, half, user_p)
    verify_url = f"{base_url}/verify?id={snapshot.id}&sig={snapshot.signature}"

    if fmt == "docx":
        if SystemSettings.is_izod_active():
            AuditLog.write(
                user_p,
                "експорт звіту Word (ДСТУ 4163:2020)",
                "zvit",
                f"portal_{year}_h{half}",
                field="format",
                old="",
                new=f"Word (.docx) за {half} півріччя {year} р.",
            )
        from .reports_docx import portal_docx
        return _docx_response(fname + ".docx", portal_docx(year, half, user_profile=user_p, base_url=base_url), user_profile=user_p)
    if fmt == "csv":
        if SystemSettings.is_izod_active():
            AuditLog.write(
                user_p,
                "експорт звіту CSV",
                "zvit",
                f"portal_{year}_h{half}",
                field="format",
                old="",
                new=f"CSV (.csv) за {half} півріччя {year} р.",
            )
        return _csv_response(fname + ".csv", keys, [[r[k] for k in keys] for r in rows], user_profile=user_p)
    if fmt == "xlsx":
        if SystemSettings.is_izod_active():
            AuditLog.write(
                user_p,
                "експорт звіту Excel",
                "zvit",
                f"portal_{year}_h{half}",
                field="format",
                old="",
                new=f"Excel (.xlsx) за {half} півріччя {year} р.",
            )
        sheets = []
        for sec in Section.objects.filter(program=pr):
            data = [[r[k] for k in keys] for r in rows if r["rozdil_portal"] == sec.portal_name]
            sheets.append((f"Розділ {sec.number}", names, data))
        return _xlsx_response(fname + ".xlsx", sheets, user_profile=user_p)
    sig1, sig2 = SystemSettings.signatories()
    return Response({
        "program": pr.name, "organ": pr.organ.name, "restricted_info": pr.restricted_info,
        "year": year, "half": half, "columns": R.REPORT_COLUMNS, "rows": rows,
        "sections": [s.portal_name for s in Section.objects.filter(program=pr)],
        "signatory_name": sig1, "head_signatory_name": sig2,
        "snapshot": {
            "id": str(snapshot.id),
            "created_at": snapshot.created_at.isoformat(),
            "report_hash": snapshot.report_hash,
            "signature": snapshot.signature,
            "verify_url": f"/verify?id={snapshot.id}&sig={snapshot.signature}",
            "qr_code": V.generate_qr_data_url(verify_url),
        }
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def verify_report(request):
    """Публічний ендпоїнт верифікації звіту за ідентифікатором та цифровим підписом HMAC."""
    from .models import ReportSnapshot
    from . import verification as V

    snap_id = request.query_params.get("id", "").strip()
    sig = request.query_params.get("sig", "").strip()
    if not snap_id or not sig:
        return Response({
            "ok": False,
            "status": "missing_params",
            "valid_signature": False,
            "message": "Параметри id та sig обов'язкові для верифікації звіту.",
        }, status=status.HTTP_400_BAD_REQUEST)

    try:
        snapshot = ReportSnapshot.objects.select_related("period").get(id=snap_id)
    except (ReportSnapshot.DoesNotExist, ValueError, DjangoValidationError):
        return Response({
            "ok": False,
            "status": "not_found",
            "valid_signature": False,
            "message": "Зліпок звіту з таким ідентифікатором не знайдено в базі даних.",
        }, status=status.HTTP_404_NOT_FOUND)

    # 1. Перевірка криптографічного HMAC-SHA256 підпису
    is_valid_sig = snapshot.verify_signature(sig)
    if not is_valid_sig:
        return Response({
            "ok": False,
            "status": "invalid_signature",
            "valid_signature": False,
            "message": "Криптографічний підпис недійсний! Можлива спроба підробки або помилка в посиланні.",
            "snapshot": {
                "id": str(snapshot.id),
                "year": snapshot.year,
                "half": snapshot.half,
                "created_at": snapshot.created_at.isoformat(),
            }
        }, status=status.HTTP_400_BAD_REQUEST)

    # 2. Звірка з поточним станом реєстру
    pr = Program.objects.first()
    current_rows = R.portal_report(pr, snapshot.year, snapshot.half)
    current_hash = V.compute_report_hash(current_rows)
    is_intact = (current_hash == snapshot.report_hash)

    # Якщо запитується експорт у Word для верифікованого звіту
    if request.query_params.get("format") == "docx":
        if SystemSettings.is_izod_active():
            u = request.user if request.user.is_authenticated else None
            p = getattr(u, "profile", None) if u else None
            AuditLog.write(
                p,
                "експорт верифікованого звіту Word (ДСТУ 4163:2020)",
                "zvit",
                f"snapshot_{str(snapshot.id)[:8]}",
                field="format",
                old="",
                new=f"Word (.docx) зліпка #{str(snapshot.id)[:8]}",
                actor_code=p.code if p else "Гість/Публічний",
            )
        from .reports_docx import portal_docx
        base_url = request.build_absolute_uri("/").rstrip("/")
        fname = f"zvit_portal_{snapshot.year}_h{snapshot.half}_verified.docx"
        return _docx_response(fname, portal_docx(snapshot.year, snapshot.half, base_url=base_url))

    status_code = "verified_intact" if is_intact else "verified_modified"
    message = (
        "Звіт офіційно верифіковано: криптографічний підпис дійсний, дані повністю відповідають актуальному стану реєстру."
        if is_intact else
        "Криптографічний підпис дійсний (звіт був офіційно зафіксований), проте після його створення дані в реєстрі змінювалися."
    )

    rows_data = snapshot.raw_data or current_rows
    sections_list = []
    seen_sec = set()
    for r in rows_data:
        sec_name = r.get("rozdil_portal", "")
        if sec_name and sec_name not in seen_sec:
            seen_sec.add(sec_name)
            sections_list.append(sec_name)

    return Response({
        "ok": True,
        "status": status_code,
        "valid_signature": True,
        "data_matches_current": is_intact,
        "message": message,
        "program_name": pr.name if pr else "Антикорупційна програма",
        "sections": sections_list,
        "columns": R.REPORT_COLUMNS,
        "docx_download_url": f"/api/reports/verify?id={snapshot.id}&sig={snapshot.signature}&format=docx",
        "snapshot": {
            "id": str(snapshot.id),
            "period_code": snapshot.period.code,
            "year": snapshot.year,
            "half": snapshot.half,
            "report_type": snapshot.report_type,
            "created_at": snapshot.created_at.isoformat(),
            "created_by": snapshot.created_by_code,
            "organ_name": snapshot.organ_name,
            "report_hash": snapshot.report_hash,
            "signature": snapshot.signature,
            "total_measures": snapshot.total_measures,
            "rows_count": snapshot.rows_count,
            "summary": snapshot.summary,
            "raw_data": rows_data,
        },
        "current_hash": current_hash,
    })


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
    if fmt in ("csv", "xlsx") and SystemSettings.is_izod_active():
        AuditLog.write(
            p,
            f"експорт внутрішнього звіту {fmt.upper()}",
            "zvit",
            f"internal_{period.code}",
            field="format",
            old="",
            new=f"Внутрішній звіт ({fmt.upper()}) за {period.code}",
        )
    if fmt == "csv":
        return _csv_response(f"vnutrishnii_zvit_{period.code}.csv", header, data, user_profile=p)
    flag_rows = [[f["code"], f["title"], f["object"], f["id"], f.get("unit") or "", f["explanation"], f["rule"]]
                 for f in fl]
    return _xlsx_response(f"vnutrishnii_zvit_{period.code}.xlsx", [
        ("Заходи", header, data),
        ("Сигнали", ["Код", "Сигнал", "Обʼєкт", "ID", "Підрозділ", "Пояснення", "Правило"], flag_rows)],
        user_profile=p)


@api_view(["GET"])
def report_note(request):
    require(request, VIEW_ALL)
    period = get_period(request)
    p = profile(request)
    if request.query_params.get("format") == "docx":
        if SystemSettings.is_izod_active():
            AuditLog.write(
                p,
                "експорт аналітичної довідки Word",
                "dovidka",
                f"note_{period.code}",
                field="format",
                old="",
                new=f"Аналітична довідка (.docx) за {period.code}",
            )
        from .reports_docx import note_docx
        return _docx_response(f"analitychna_dovidka_{period.code}.docx", note_docx(period, user_profile=p), user_profile=p)
    note = R.analytic_note(period)
    sig1, sig2 = SystemSettings.signatories()
    note["signatory_name"] = sig1
    note["head_signatory_name"] = sig2
    if request.query_params.get("format") == "md":
        if SystemSettings.is_izod_active():
            AuditLog.write(
                profile(request),
                "експорт аналітичної довідки Markdown",
                "dovidka",
                f"note_{period.code}",
                field="format",
                old="",
                new=f"Аналітична довідка (.md) за {period.code}",
            )
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
    actor_code = a.resolved_actor_code or None
    return {"id": a.id, "ts": a.ts, "actor": actor_code,
            "actor_role": a.actor.get_role_display() if a.actor else None, "action": a.action,
            "obj_type": a.obj_type, "obj_id": a.obj_id, "field": a.field, "old": a.old_value, "new": a.new_value,
            "hash": a.hash, "prev_hash": a.prev_hash}


def _filter_audit_qs(qs, q):
    if q.get("obj_id"):
        qs = qs.filter(obj_id=q["obj_id"].strip())
    if q.get("actor"):
        act = q["actor"].strip()
        qs = qs.filter(actor_code__iexact=act) | qs.filter(actor__code__iexact=act)
    if q.get("action"):
        qs = qs.filter(action__icontains=q["action"].strip())
    category = q.get("category", "").strip().lower()
    if category == "views":
        qs = qs.filter(action__icontains="перегляд")
    elif category == "evidence":
        qs = qs.filter(Q(action__icontains="завантаження підтвердного") | Q(obj_type="evidence_file"))
    elif category == "export":
        qs = qs.filter(Q(action__icontains="експорт") | Q(action__icontains="друк"))
    elif category == "changes":
        qs = qs.exclude(
            Q(action__icontains="перегляд")
            | Q(action__icontains="експорт")
            | Q(action__icontains="друк")
            | Q(action__icontains="завантаження підтвердного")
            | Q(action__icontains="вхід")
            | Q(action__icontains="вихід")
        )
    elif category == "auth":
        qs = qs.filter(Q(action__icontains="вхід") | Q(action__icontains="вихід"))
    return qs


@api_view(["GET"])
def audit(request):
    require(request, AUDIT, "Журнал дій доступний уповноваженому, техадміністратору, керівнику та аналітику.")
    qs = AuditLog.objects.select_related("actor").order_by("-id")
    qs = _filter_audit_qs(qs, request.query_params)
    limit = _parse_int(request.query_params.get("limit", 200), field="limit", min_val=1, max_val=2000)
    return Response({"total": qs.count(), "items": [_audit_dict(a) for a in qs[:limit]]})


@api_view(["GET"])
def audit_verify(request):
    require(request, AUDIT)
    return Response(AuditLog.verify_chain())


@api_view(["GET"])
def audit_export(request):
    require(request, AUDIT)
    qs = AuditLog.objects.select_related("actor").order_by("-id")
    qs = _filter_audit_qs(qs, request.query_params)

    if SystemSettings.is_izod_active():
        AuditLog.write(
            profile(request),
            "експорт журналу аудиту CSV",
            "audit",
            "all",
            "filters",
            "",
            f"cat={request.query_params.get('category','')},act={request.query_params.get('action','')}"[:100],
        )

    header = ["id", "chas", "korystuvach", "diia", "obiekt", "obiekt_id", "pole", "stare", "nove", "prev_hash", "hash"]
    data = [[a.id, a.ts.isoformat(), a.resolved_actor_code, a.action, a.obj_type, a.obj_id, a.field,
             a.old_value, a.new_value, a.prev_hash, a.hash] for a in qs]
    return _csv_response("zhurnal_dii.csv", header, data)


@api_view(["POST"])
@permission_classes([AllowAny])
def log_print_action(request):
    """Фіксація факту друку звіту або форми у ланцюжку аудиту (режим ІзОД)."""
    u = request.user if request.user and request.user.is_authenticated else None
    p = getattr(u, "profile", None) if u else None
    d = request.data or {}
    title = str(d.get("title") or "Друк звіту").strip()[:200]
    obj_id = str(d.get("obj_id") or "print").strip()[:30]
    obj_type = str(d.get("obj_type") or "zvit").strip()[:30]
    if SystemSettings.is_izod_active():
        AuditLog.write(
            p,
            f"друк: {title}",
            obj_type,
            obj_id,
            field="druk",
            old="",
            new="Друк через веб-браузер",
            actor_code=p.code if p else "Гість/Публічний",
        )
    return Response({"ok": True})


# ---------------------------------------------------------------- опитування
@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def surveys(request):
    p = profile(request)
    if request.method == "POST":
        p = require(request, SURVEYS_EDIT, "Завантажувати результати опитування може лише уповноважений.")
        f = request.FILES.get("file")
        if not f:
            raise ValidationError({"file": "Завантажте файл CSV або Excel (.xlsx), експортований з форми."})
        try:
            parsed = parse_survey_file(f.read(), f.name)
        except Exception as e:  # noqa: BLE001
            raise ValidationError({"file": f"Не вдалося прочитати файл опитування: {e}"})
        s = Survey.objects.create(title=request.data.get("title") or f.name, uploaded_by=p,
                                  questions=parsed["questions"], answers=parsed["answers"],
                                  dropped_columns=parsed["dropped"])
        AuditLog.write(p, "завантажено результати опитування", "opytuvannia", s.id, "vidpovidei", "", s.n)
        return Response({"id": s.id, "n": s.n, "dropped_columns": s.dropped_columns}, status=201)

    require(request, SURVEYS_VIEW, "Опитування доступні уповноваженому та аналітику.")
    return Response([{"id": s.id, "title": s.title, "uploaded_at": s.uploaded_at, "n": s.n,
                      "questions": len(s.questions), "dropped_columns": s.dropped_columns}
                     for s in Survey.objects.order_by("uploaded_at")])


@api_view(["DELETE"])
def survey_delete(request, pk):
    p = require(request, SURVEYS_EDIT, "Видаляти опитування може лише уповноважений.")
    s = get_object_or_404(Survey, pk=pk)
    AuditLog.write(p, "видалено результати опитування", "opytuvannia", s.id, "title", s.title, "")
    s.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def survey_compare(request):
    p = require(request, SURVEYS_VIEW, "Опитування доступні уповноваженому та аналітику.")
    a = get_object_or_404(Survey, pk=request.query_params.get("a"))
    b = get_object_or_404(Survey, pk=request.query_params.get("b"))
    da = {"questions": a.questions, "answers": a.answers}
    db = {"questions": b.questions, "answers": b.answers}
    res = compare_surveys(da, db, SystemSettings.get().min_survey_group,
                         request.query_params.get("fq"), request.query_params.get("fv"))
    res.update({"a": {"id": a.id, "title": a.title}, "b": {"id": b.id, "title": b.title},
                "filters": group_options(da, db)})

    fmt = request.query_params.get("format", "").strip().lower()
    if fmt == "xlsx":
        if SystemSettings.is_izod_active():
            AuditLog.write(p, "експорт результатів опитування XLSX", "opytuvannia", f"{a.id}_{b.id}")
        from .surveys import survey_xlsx
        resp = HttpResponse(
            survey_xlsx(res, p),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        resp["Content-Disposition"] = f'attachment; filename="porivniannia_opytuvan_{a.id}_vs_{b.id}.xlsx"'
        if p and p.role == Role.ANAL:
            now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
            resp["X-Digital-Footprint"] = f"ANAL · {p.code} · {now_str}"
            resp["X-IzOD-Watermark"] = f"ІзОД / ДСК · ANAL · {p.code} · {now_str}"
        return resp

    if fmt == "docx":
        if SystemSettings.is_izod_active():
            AuditLog.write(p, "експорт результатів опитування Word (ДСТУ 4163:2020)", "opytuvannia", f"{a.id}_{b.id}")
        from .surveys import survey_docx
        return _docx_response(f"analitychnyi_zvit_opytuvannia_{a.id}_vs_{b.id}.docx", survey_docx(res, p), user_profile=p)

    if SystemSettings.is_izod_active():
        AuditLog.write(
            p,
            "перегляд порівняння опитувань",
            "opytuvannia",
            f"{a.id}_vs_{b.id}",
            "a_b",
            "",
            f"{a.title[:40]} / {b.title[:40]}",
        )

    return Response(res)


# ---------------------------------------------------------------- технічне адміністрування
@api_view(["GET", "POST"])
def users(request):
    p = require(request, TECH, "Облікові записи веде технічний адміністратор.")
    if request.method == "POST":
        d = request.data
        code = (d.get("code") or "").strip().upper()
        if not code or not re.match(r"^[A-Z0-9_-]{2,10}$", code):
            raise ValidationError({"code": "Код має містити 2–10 латинських літер, цифр або дефіс (наприклад, U-020)."})
        if Profile.objects.filter(code=code).exists() or User.objects.filter(username=code.lower()).exists():
            raise ValidationError({"code": "Обліковий запис із таким кодом уже існує."})
        if d.get("role") not in dict(Role.choices):
            raise ValidationError({"role": "Невідома роль."})
        unit = Unit.objects.filter(code=d.get("unit")).first()
        if d["role"] == Role.VYK and not unit:
            raise ValidationError({"unit": "Виконавцю потрібен підрозділ."})
        raw_pw = str(d.get("password") or "demo")
        if len(raw_pw) < 4:
            raise ValidationError({"password": "Пароль має містити щонайменше 4 символи."})
        u = User.objects.create_user(username=code.lower(), password=raw_pw)
        Token.objects.create(user=u)
        np = Profile.objects.create(user=u, code=code, full_name="",
                                    role=d["role"], unit=unit, position=str(d.get("position") or "").strip()[:300])
        AuditLog.write(p, "створено обліковий запис", "korystuvach", code, "role", "", d["role"])
        return Response(profile_dict(np), status=201)
    return Response([profile_dict(x) for x in Profile.objects.select_related("unit", "user").order_by("code")])


@api_view(["PATCH", "DELETE"])
def user_update(request, code):
    p = require(request, TECH, "Облікові записи веде технічний адміністратор.")
    x = get_object_or_404(Profile, code=code)
    if request.method == "DELETE":
        if x.code == p.code:
            raise ValidationError({"detail": "Не можна видалити власний обліковий запис."})
        u = x.user
        c_code = x.code
        from django.db.models.deletion import ProtectedError
        try:
            with transaction.atomic():
                Token.objects.filter(user=u).delete()
                x.delete()
                u.delete()
                AuditLog.write(p, "видалено обліковий запис", "korystuvach", c_code)
        except ProtectedError:
            raise ValidationError({"detail": "Неможливо видалити користувача, оскільки з ним повʼязані захищені записи."})
        return Response(status=status.HTTP_204_NO_CONTENT)
    d = request.data
    if "role" in d and d["role"] != x.role:
        if d["role"] not in dict(Role.choices):
            raise ValidationError({"role": "Невідома роль."})
        if x.code == p.code and d["role"] != Role.ADMIN:
            raise ValidationError({"role": "Не можна зняти роль адміністратора з власного облікового запису."})
        target_unit = Unit.objects.filter(code=d["unit"]).first() if "unit" in d else x.unit
        if d["role"] == Role.VYK and not target_unit:
            raise ValidationError({"unit": "Виконавцю потрібен підрозділ."})
        AuditLog.write(p, "змінено роль", "korystuvach", x.code, "role", x.role, d["role"])
        x.role = d["role"]
    if "unit" in d:
        unit = Unit.objects.filter(code=d["unit"]).first()
        if x.role == Role.VYK and not unit:
            raise ValidationError({"unit": "Виконавцю потрібен підрозділ."})
        if (x.unit.code if x.unit else "") != (unit.code if unit else ""):
            AuditLog.write(p, "змінено підрозділ", "korystuvach", x.code, "unit", x.unit.code if x.unit else "",
                           unit.code if unit else "")
            x.unit = unit
    if "position" in d:
        x.position = str(d["position"] or "").strip()[:300]
    x.save()
    if "is_active" in d:
        new_active = bool(d["is_active"])
        if x.code == p.code and not new_active:
            raise ValidationError({"is_active": "Не можна заблокувати власний обліковий запис."})
        if x.user.is_active != new_active:
            x.user.is_active = new_active
            x.user.save()
            if not new_active:
                Token.objects.filter(user=x.user).delete()
            AuditLog.write(p, "змінено активність", "korystuvach", x.code, "is_active", not new_active, new_active)
    if d.get("password"):
        raw_pw = str(d["password"])
        if len(raw_pw) < 4:
            raise ValidationError({"password": "Пароль має містити щонайменше 4 символи."})
        x.user.set_password(raw_pw)
        x.user.save()
        Token.objects.filter(user=x.user).delete()
        Token.objects.create(user=x.user)
        AuditLog.write(p, "скинуто пароль", "korystuvach", x.code)
    return Response(profile_dict(x))


@api_view(["GET"])
def admin_keys(request):
    """Список користувачів та стан їхніх ключів доступу (.key) для тех-адміністратора."""
    require(request, TECH, "Керування ключами доступу веде технічний адміністратор.")
    items = []
    for p in Profile.objects.select_related("user", "unit").order_by("code"):
        act = p.active_key
        lat = p.latest_key
        if act:
            st = "active"
            st_name = "Активний"
            fp = act.fingerprint
            issued_at = act.created_at.isoformat()
        elif lat and lat.is_revoked:
            st = "revoked"
            st_name = "Відкликано"
            fp = lat.fingerprint
            issued_at = lat.created_at.isoformat()
        else:
            st = "none"
            st_name = "Не випущено"
            fp = None
            issued_at = None

        items.append({
            "code": p.code,
            "username": p.user.username,
            "full_name": p.full_name,
            "role": p.role,
            "role_name": p.get_role_display(),
            "unit": unit_dict(p.unit),
            "position": p.position,
            "is_active": p.user.is_active,
            "status": st,
            "status_name": st_name,
            "fingerprint": fp,
            "issued_at": issued_at,
        })
    return Response(items)


@api_view(["POST"])
def admin_key_register(request):
    """Реєстрація публічного ключа, згенерованого в браузері адміністратора."""
    admin_p = require(request, TECH, "Керування ключами доступу веде технічний адміністратор.")
    user_code = str(request.data.get("user_code") or request.data.get("code") or "").strip().upper()
    pub_pem = str(request.data.get("public_key_pem") or "").strip()

    if not user_code or not pub_pem:
        raise ValidationError({"detail": "Необхідно вказати код користувача та публічний ключ."})

    target_profile = get_object_or_404(Profile, code=user_code)
    target_user = target_profile.user

    try:
        calculated_fp = calculate_public_key_fingerprint(pub_pem)
    except Exception as e:
        raise ValidationError({"detail": f"Некоректний формат публічного ключа: {e}"})

    with transaction.atomic():
        target_user.access_keys.filter(is_revoked=False).update(
            is_revoked=True,
            revoked_at=timezone.now(),
        )
        new_key = UserAccessKey.objects.create(
            user=target_user,
            public_key_pem=pub_pem,
            fingerprint=calculated_fp,
        )
        AuditLog.write(
            admin_p,
            "випуск ключа доступу (.key)",
            "korystuvach",
            target_profile.code,
            field="key_fingerprint",
            new=calculated_fp,
        )

    return Response({
        "ok": True,
        "fingerprint": calculated_fp,
        "user_code": target_profile.code,
        "created_at": new_key.created_at.isoformat(),
    }, status=201)


@api_view(["POST"])
def admin_key_revoke(request, code):
    """Відкликання активного ключа доступу користувача."""
    admin_p = require(request, TECH, "Керування ключами доступу веде технічний адміністратор.")
    target_profile = get_object_or_404(Profile, code=code.strip().upper())
    target_user = target_profile.user

    active_keys = target_user.access_keys.filter(is_revoked=False)
    if not active_keys.exists():
        raise ValidationError({"detail": "У користувача немає активного ключа для відкликання."})

    first_fp = active_keys.first().fingerprint
    with transaction.atomic():
        active_keys.update(is_revoked=True, revoked_at=timezone.now())
        AuditLog.write(
            admin_p,
            "відкликання ключа доступу (.key)",
            "korystuvach",
            target_profile.code,
            field="key_fingerprint",
            old=first_fp,
            new="revoked",
        )

    return Response({"ok": True, "user_code": target_profile.code})



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


def custom_exception_handler(exc, context):
    """Уніфікований JSON-обробник винятків DRF без витоку стектрейсів (OWASP Top 10 A05)."""
    response = drf_exception_handler(exc, context)
    if response is None:
        logger.error("Неперехоплений виняток сервера: %s", exc, exc_info=True)
        return JsonResponse(
            {"detail": "Внутрішня помилка сервера. Спробуйте пізніше."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return response


def custom_400(request, exception=None):
    return JsonResponse({"detail": "Некоректний запит."}, status=400)


def custom_403(request, exception=None):
    return JsonResponse({"detail": "Доступ заборонено."}, status=403)


def custom_404(request, exception=None):
    if not request.path.startswith("/api/"):
        from config.urls import spa
        return spa(request)
    return JsonResponse({"detail": "Запитуваний ресурс не знайдено."}, status=404)


def custom_500(request):
    logger.error("HTTP 500 error on path %s", getattr(request, "path", ""))
    return JsonResponse({"detail": "Внутрішня помилка сервера. Спробуйте пізніше."}, status=500)
