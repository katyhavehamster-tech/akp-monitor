"""Криптографічна верифікація звітів (HMAC-SHA256) та генерація QR-кодів.

Кожен згенерований або експортований звіт фіксується у вигляді незмінного зліпка
(ReportSnapshot), що містить SHA-256 хеш даних і HMAC-SHA256 підпис сервера.
QR-код веде на публічну сторінку /verify?id=...&sig=..., де будь-яка особа може
перевірити оригінальність документа та звірити його з актуальними даними в базі.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json

import qrcode

from . import rules as R
from .models import Profile, Program, ReportingPeriod, ReportSnapshot


def compute_report_hash(rows: list[dict]) -> str:
    """Обчислює детермінований контрольний SHA-256 хеш рядків звіту."""
    canonical = json.dumps(rows, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def generate_qr_png_bytes(verify_url: str) -> bytes:
    """Генерує зображення QR-коду у форматі PNG (в памʼяті, без зовнішніх сервісів)."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(verify_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_qr_data_url(verify_url: str) -> str:
    """Генерує Data URL (base64) для вбудовування QR-коду в HTML/React."""
    png_bytes = generate_qr_png_bytes(verify_url)
    encoded = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def get_or_create_portal_snapshot(year: int, half: int, user_profile: Profile | None = None) -> ReportSnapshot:
    """Отримує наявний або створює новий незмінний зліпок звіту НАЗК для поточного стану даних."""
    quarter = 2 if half == 1 else 4
    period = ReportingPeriod.objects.get(year=year, quarter=quarter)
    pr = Program.objects.select_related("organ").first()
    rows = R.portal_report(pr, year, half)
    rep_hash = compute_report_hash(rows)

    # Якщо зліпок для цього півріччя з таким самим хешем уже зафіксовано — повторно використовуємо його
    existing = ReportSnapshot.objects.filter(
        period=period,
        year=year,
        half=half,
        report_type="portal",
        report_hash=rep_hash,
    ).order_by("-created_at").first()

    if existing:
        return existing

    # Створюємо новий незмінний зліпок
    counts: dict[str, int] = {}
    for r in rows:
        st = r.get("stan_vykonannia", "Невідомо")
        counts[st] = counts.get(st, 0) + 1

    organ_name = pr.organ.name.replace(" (вигадане)", "") if pr and pr.organ else ""
    code_val = user_profile.code if user_profile else ""

    snapshot = ReportSnapshot(
        period=period,
        year=year,
        half=half,
        report_type="portal",
        rules_version=R.RULES_VERSION,
        created_by=user_profile,
        created_by_code=code_val,
        organ_name=organ_name,
        report_hash=rep_hash,
        total_measures=len(rows),
        rows_count=len(rows),
        summary=counts,
        raw_data=rows,
    )
    # signature обчислюється автоматично у моделі при збереженні
    snapshot.save()
    return snapshot
